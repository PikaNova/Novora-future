import {
  ERROR_REPORT_CHANNEL,
  buildErrorReportFingerprint,
  normalizeErrorReportLevel,
  normalizeErrorReportType,
  sanitizeErrorReportContext,
  sanitizeErrorReportPayload,
  sanitizeErrorReportPath,
  sanitizeErrorReportStack,
  sanitizeErrorReportText,
} from '../shared/errorReportContracts';
import { APP_VERSION, getInstanceId, isEnabled } from './telemetry';
import type { ErrorReportLevel, ErrorReportType } from '../shared/errorReportContracts';
import { getAppSettings } from '../utils/appSettings';

export type { ErrorReportLevel, ErrorReportType } from '../shared/errorReportContracts';

export interface ErrorReportInput {
  message: string;
  errorName?: string;
  stack?: string;
  type?: ErrorReportType;
  level?: ErrorReportLevel;
  deviceId?: string;
  route?: string;
  action?: string;
  apiEndpoint?: string;
  httpStatus?: number;
  context?: Record<string, unknown>;
}

interface QueuedErrorReport {
  payload: Record<string, unknown>;
  attempts: number;
  nextAttemptAt: number;
}

const ERROR_QUEUE_KEY = 'novora_error_report_queue_v1';
const MAX_QUEUE_ITEMS = 20;
const MAX_QUEUE_ATTEMPTS = 3;
const DEDUPE_WINDOW_MS = 60_000;
const recentFingerprints = new Map<string, number>();
let flushing = false;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function inferType(input: ErrorReportInput): ErrorReportType {
  if (input.type) return normalizeErrorReportType(input.type);
  if (input.action === 'react-render') return 'react';
  if (input.action === 'window.onerror' || input.action === 'unhandledrejection') return 'js';
  if (input.httpStatus === 0) return 'network';
  if (input.apiEndpoint) return 'api';
  return 'unknown';
}

function shouldSkipDuplicate(fingerprint: string): boolean {
  const now = Date.now();
  const last = recentFingerprints.get(fingerprint);
  if (last && now - last < DEDUPE_WINDOW_MS) return true;
  recentFingerprints.set(fingerprint, now);
  if (recentFingerprints.size > 200) {
    const cutoff = now - DEDUPE_WINDOW_MS;
    for (const [key, time] of recentFingerprints) if (time < cutoff) recentFingerprints.delete(key);
  }
  return false;
}

function readQueue(): QueuedErrorReport[] {
  const raw = storage()?.getItem(ERROR_QUEUE_KEY);
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is QueuedErrorReport => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Partial<QueuedErrorReport>;
      return !!candidate.payload && typeof candidate.payload === 'object' && Number.isFinite(candidate.attempts);
    });
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedErrorReport[]): void {
  try {
    storage()?.setItem(ERROR_QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE_ITEMS)));
  } catch {
    // Reporting remains best-effort when storage is disabled or full.
  }
}

function enqueue(payload: Record<string, unknown>, attempts = 0): void {
  const queue = readQueue();
  queue.push({ payload, attempts, nextAttemptAt: Date.now() });
  writeQueue(queue);
}

function retryDelay(attempts: number): number {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
}

async function sendPayload(payload: Record<string, unknown>): Promise<'sent' | 'retry' | 'drop'> {
  try {
    const response = await fetch('/api/error-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Error-Report-Schema': '1' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    if (response.ok || response.status === 202) return 'sent';
    return response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500
      ? 'retry'
      : 'drop';
  } catch {
    return 'retry';
  }
}

async function flushQueuedReports(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const queue = readQueue();
    if (!queue.length) return;
    const now = Date.now();
    const remaining: QueuedErrorReport[] = [];
    for (const item of queue.slice(0, 3)) {
      if (item.nextAttemptAt > now) {
        remaining.push(item);
        continue;
      }
      const result = await sendPayload(item.payload);
      if (result === 'sent' || result === 'drop') continue;
      const attempts = item.attempts + 1;
      if (attempts < MAX_QUEUE_ATTEMPTS) {
        remaining.push({ ...item, attempts, nextAttemptAt: Date.now() + retryDelay(attempts) });
      }
    }
    remaining.push(...queue.slice(3));
    writeQueue(remaining);
  } finally {
    flushing = false;
  }
}

function buildPayload(input: ErrorReportInput): Record<string, unknown> | null {
  const type = inferType(input);
  const message = sanitizeErrorReportText(input.message);
  if (!message) return null;
  const route = sanitizeErrorReportPath(input.route);
  const apiEndpoint = sanitizeErrorReportPath(input.apiEndpoint, 160);
  let schoolName: string | undefined;
  let province: string | undefined;
  try {
    const school = getAppSettings().exam.initialization;
    schoolName = school.schoolFullName || school.schoolName;
    province = school.province;
  } catch {
    // Error reporting must stay silent when local settings are unavailable.
  }
  const payload = sanitizeErrorReportPayload({
    schemaVersion: 1,
    clientChannel: ERROR_REPORT_CHANNEL,
    instanceId: getInstanceId(),
    deviceId: input.deviceId,
    type,
    level: normalizeErrorReportLevel(input.level),
    fingerprint: buildErrorReportFingerprint({ type, errorName: input.errorName, message, route, apiEndpoint }),
    errorName: input.errorName,
    message,
    stack: sanitizeErrorReportStack(input.stack),
    route,
    action: input.action,
    apiEndpoint,
    httpStatus: input.httpStatus,
    context: sanitizeErrorReportContext(input.context),
    appVersion: APP_VERSION,
    clientTs: Date.now(),
    schoolName,
    province,
    host: typeof location === 'undefined' ? null : location.host,
    userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
    tz: typeof Intl === 'undefined' ? null : Intl.DateTimeFormat().resolvedOptions().timeZone,
    lang: typeof navigator === 'undefined' ? null : navigator.language,
  });
  return payload ? (payload as unknown as Record<string, unknown>) : null;
}

export async function reportError(input: ErrorReportInput): Promise<void> {
  if (!isEnabled() || !input?.message) return;
  const type = inferType(input);
  const fingerprint = buildErrorReportFingerprint({
    type,
    errorName: input.errorName,
    message: input.message,
    route: input.route,
    apiEndpoint: input.apiEndpoint,
  });
  if (shouldSkipDuplicate(fingerprint)) return;
  const payload = buildPayload(input);
  if (!payload) return;
  await flushQueuedReports();
  if ((await sendPayload(payload)) === 'retry') enqueue(payload);
}

let installed = false;

export function installGlobalErrorReporting(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (event: ErrorEvent) => {
    const error = event.error;
    void reportError({
      message:
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : event.message || '未知的全局错误',
      errorName: error && typeof error === 'object' && 'name' in error ? String(error.name) : 'Error',
      stack: error && typeof error === 'object' && 'stack' in error ? String(error.stack) : undefined,
      type: 'js',
      level: 'error',
      action: 'window.onerror',
    });
  });
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const error = reason && typeof reason === 'object' ? reason : null;
    void reportError({
      message:
        error && 'message' in error
          ? String(error.message)
          : typeof reason === 'string'
            ? reason
            : '未处理的 Promise 拒绝',
      errorName: error && 'name' in error ? String(error.name) : 'UnhandledRejection',
      stack: error && 'stack' in error ? String(error.stack) : undefined,
      type: 'js',
      level: 'error',
      action: 'unhandledrejection',
    });
  });
  window.addEventListener('online', () => void flushQueuedReports());
}
