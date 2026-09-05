export const ERROR_REPORT_SCHEMA_VERSION = 1 as const;
export const ERROR_REPORT_CHANNEL = 'novora-client-v2' as const;

export const ERROR_REPORT_TYPES = ['js', 'api', 'react', 'network', 'sync', 'database', 'unknown'] as const;
export type ErrorReportType = (typeof ERROR_REPORT_TYPES)[number];

export const ERROR_REPORT_LEVELS = ['critical', 'error', 'warning', 'info'] as const;
export type ErrorReportLevel = (typeof ERROR_REPORT_LEVELS)[number];

export const ERROR_CONTEXT_KEYS = [
  'requestId',
  'operation',
  'retryable',
  'retryAfterMs',
  'syncState',
  'status',
  'component',
  'resource',
  'durationMs',
  'attempt',
  'queued',
  'online',
  'source',
] as const;
const ALLOWED_CONTEXT_KEYS = new Set<string>(ERROR_CONTEXT_KEYS);

export type ErrorReportContextValue = string | number | boolean;
export type ErrorReportContext = Record<string, ErrorReportContextValue>;

export interface ErrorReportPayload {
  schemaVersion: typeof ERROR_REPORT_SCHEMA_VERSION;
  clientChannel: typeof ERROR_REPORT_CHANNEL;
  instanceId: string;
  deviceId?: string | null;
  type: ErrorReportType;
  level: ErrorReportLevel;
  fingerprint: string;
  errorName?: string | null;
  message: string;
  stack?: string | null;
  route?: string | null;
  action?: string | null;
  apiEndpoint?: string | null;
  httpStatus?: number | null;
  context?: ErrorReportContext | null;
  appVersion: string;
  clientTs?: number | null;
  schoolName?: string | null;
  host?: string | null;
  userAgent?: string | null;
  province?: string | null;
  tz?: string | null;
  lang?: string | null;
}

const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 4_000;
const MAX_NAME_LENGTH = 120;
const MAX_ROUTE_LENGTH = 160;
const MAX_ACTION_LENGTH = 100;
const MAX_ENDPOINT_LENGTH = 160;
const MAX_FINGERPRINT_LENGTH = 64;
const MAX_CONTEXT_VALUE_LENGTH = 160;
const MAX_ID_LENGTH = 96;

// Keep operational identifiers useful while removing values that can identify a person or expose credentials.
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:basic|digest)\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|password|passwd|secret|cookie)\s*[:=]\s*[^\s,;]+/gi,
  /(?:^|[?&])(?:token|access_token|refresh_token|api_key|key|secret|password)=[^&#\s]+/gi,
];
const PERSONAL_VALUE_PATTERNS = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  /(?:\+?86[-\s]?)?1\d{10}/g,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
];
const BUSINESS_VALUE_PATTERNS = [
  /\b(?:exam|subject|class|grade|school|student|question|answer|score)(?:\s|[_-])*(?:name|title|id|code)?\s*[:=]\s*[^,;\n]+/gi,
  /(?:考试|科目|班级|年级|学校|学生|题目|答案|成绩)(?:名称|标题|编号|代码|ID)?\s*[:：=]\s*[^，,；;\n]+/g,
];
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const LONG_HEX_PATTERN = /\b[0-9a-f]{16,}\b/gi;
const ISO_TIME_PATTERN = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
// eslint-disable-next-line no-control-regex -- security boundary for untrusted diagnostic text
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function cleanText(value: unknown, maxLength: number, preserveNewlines = false): string | null {
  if (value == null) return null;
  let text = String(value);
  // Security boundary: discard control characters before storing or relaying diagnostics.
  text = text.replace(CONTROL_CHARACTER_PATTERN, ' ');
  if (!preserveNewlines) text = text.replace(/[\r\n\t]+/g, ' ');
  for (const pattern of [...SECRET_VALUE_PATTERNS, ...PERSONAL_VALUE_PATTERNS, ...BUSINESS_VALUE_PATTERNS]) {
    text = text.replace(pattern, '<redacted>');
  }
  return text.trim().slice(0, maxLength) || null;
}

export function sanitizeErrorReportText(value: unknown, maxLength = MAX_MESSAGE_LENGTH): string | null {
  return cleanText(value, maxLength);
}

export function sanitizeErrorReportStack(value: unknown): string | null {
  const cleaned = cleanText(value, MAX_STACK_LENGTH, true);
  return cleaned ? cleaned.split('\n').slice(0, 40).join('\n').slice(0, MAX_STACK_LENGTH) : null;
}

export function sanitizeErrorReportId(value: unknown): string | null {
  return cleanText(value, MAX_ID_LENGTH);
}

function normalizeDynamicValues(value: string): string {
  return value
    .replace(UUID_PATTERN, '<uuid>')
    .replace(ISO_TIME_PATTERN, '<time>')
    .replace(LONG_HEX_PATTERN, '<hex>')
    .replace(/\b\d+\b/g, '<number>')
    .replace(/([?&][^\s=&#]+)=([^&#\s]*)/g, '$1=<param>');
}

export function sanitizeErrorReportPath(value: unknown, maxLength = MAX_ROUTE_LENGTH): string | null {
  if (value == null) return null;
  const raw = String(value).replace(CONTROL_CHARACTER_PATTERN, ' ').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw, 'https://novora.invalid');
    const path = cleanText(parsed.pathname || '/', maxLength);
    return path ? normalizeDynamicValues(path).slice(0, maxLength) : '/';
  } catch {
    const path = cleanText(raw.split(/[?#]/, 1)[0] || '/', maxLength);
    return path ? normalizeDynamicValues(path).slice(0, maxLength) : '/';
  }
}

export function sanitizeErrorReportContext(value: unknown): ErrorReportContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result: ErrorReportContext = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!ALLOWED_CONTEXT_KEYS.has(key) || raw == null) continue;
    if (typeof raw === 'string') {
      const sanitized = cleanText(raw, MAX_CONTEXT_VALUE_LENGTH);
      if (sanitized) result[key] = sanitized;
    } else if (typeof raw === 'number' && Number.isFinite(raw) && Math.abs(raw) <= 1_000_000_000) {
      result[key] = raw;
    } else if (typeof raw === 'boolean') {
      result[key] = raw;
    }
    if (Object.keys(result).length >= ERROR_CONTEXT_KEYS.length) break;
  }
  return Object.keys(result).length ? result : null;
}

export function normalizeErrorReportType(value: unknown): ErrorReportType {
  return typeof value === 'string' && (ERROR_REPORT_TYPES as readonly string[]).includes(value)
    ? (value as ErrorReportType)
    : 'unknown';
}

export function normalizeErrorReportLevel(value: unknown): ErrorReportLevel {
  return typeof value === 'string' && (ERROR_REPORT_LEVELS as readonly string[]).includes(value)
    ? (value as ErrorReportLevel)
    : 'error';
}

export function buildErrorReportFingerprint(input: {
  type: ErrorReportType;
  errorName?: unknown;
  message: unknown;
  route?: unknown;
  apiEndpoint?: unknown;
}): string {
  const base = normalizeDynamicValues(
    [
      input.type,
      cleanText(input.errorName, MAX_NAME_LENGTH) || 'Error',
      cleanText(input.message, MAX_MESSAGE_LENGTH) || 'Unknown error',
      sanitizeErrorReportPath(input.route, MAX_ROUTE_LENGTH) || '',
      sanitizeErrorReportPath(input.apiEndpoint, MAX_ENDPOINT_LENGTH) || '',
    ].join('|'),
  );
  let hash = 2_166_136_261;
  for (let index = 0; index < base.length; index += 1) {
    hash ^= base.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `fp_${(hash >>> 0).toString(36)}`.slice(0, MAX_FINGERPRINT_LENGTH);
}

export function sanitizeErrorReportPayload(input: Partial<ErrorReportPayload>): ErrorReportPayload | null {
  const instanceId = sanitizeErrorReportId(input.instanceId);
  const message = cleanText(input.message, MAX_MESSAGE_LENGTH);
  if (!instanceId || !message) return null;
  const type = normalizeErrorReportType(input.type);
  const route = sanitizeErrorReportPath(input.route, MAX_ROUTE_LENGTH);
  const apiEndpoint = sanitizeErrorReportPath(input.apiEndpoint, MAX_ENDPOINT_LENGTH);
  return {
    schemaVersion: ERROR_REPORT_SCHEMA_VERSION,
    clientChannel: ERROR_REPORT_CHANNEL,
    instanceId,
    deviceId: sanitizeErrorReportId(input.deviceId),
    type,
    level: normalizeErrorReportLevel(input.level),
    fingerprint:
      cleanText(input.fingerprint, MAX_FINGERPRINT_LENGTH) ||
      buildErrorReportFingerprint({ type, errorName: input.errorName, message, route, apiEndpoint }),
    errorName: cleanText(input.errorName, MAX_NAME_LENGTH),
    message,
    stack: sanitizeErrorReportStack(input.stack),
    route,
    action: cleanText(input.action, MAX_ACTION_LENGTH),
    apiEndpoint,
    httpStatus:
      typeof input.httpStatus === 'number' &&
      Number.isInteger(input.httpStatus) &&
      input.httpStatus >= 0 &&
      input.httpStatus <= 599
        ? input.httpStatus
        : null,
    context: sanitizeErrorReportContext(input.context),
    appVersion: cleanText(input.appVersion, 32) || 'unknown',
    clientTs:
      typeof input.clientTs === 'number' && Number.isFinite(input.clientTs) && input.clientTs > 0
        ? Math.round(input.clientTs)
        : null,
    schoolName: cleanText(input.schoolName, 80),
    host: cleanText(input.host, 128),
    userAgent: cleanText(input.userAgent, 512),
    province: cleanText(input.province, 40),
    tz: cleanText(input.tz, 64),
    lang: cleanText(input.lang, 32),
  };
}
