// 平台额度功能的 HTTP 层。三个入口都挂在 api/system.ts 的合并函数上：
//   GET  /api/system?sys=platform-usage         读取配置与最近快照
//   POST /api/system?sys=platform-usage-config  保存或清除凭据
//   POST /api/system?sys=platform-usage-refresh 主动刷新一次读数
//
// 全部要求超级管理员；本地部署下没有可启用的平台，接口仍可访问但返回空列表。
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authSql, requireActor } from '../_auth.js';
import { sendDatabaseError } from '../_apiError.js';
import { decryptSecret, encryptSecret, secretHint } from './crypto.js';
import { detectPlatformEnvironment, type PlatformEnvironment } from './environment.js';
import { collectNeonUsage } from './neon.js';
import {
  clearPlatformConfig,
  encryptionSecret,
  ensurePlatformUsageTables,
  readPlatformConfig,
  readPlatformSnapshot,
  writePlatformConfig,
  writePlatformSnapshot,
  type StoredPlatformSnapshot,
} from './store.js';
import {
  isPlatformProviderId,
  type PlatformConfigFieldSpec,
  type PlatformMetric,
  type PlatformProviderId,
  type PlatformProviderSnapshot,
  type PlatformProviderView,
  type PlatformStatus,
  type PlatformUsagePayload,
} from './types.js';
import { collectVercelUsage } from './vercel.js';

const CONSOLE_URLS: Record<PlatformProviderId, string> = {
  vercel: 'https://vercel.com/dashboard/usage',
  neon: 'https://console.neon.tech',
};

const LABELS: Record<PlatformProviderId, string> = { vercel: 'Vercel', neon: 'Neon' };

/** 必填的密钥字段，用于生成尾号提示。 */
const SECRET_FIELD: Record<PlatformProviderId, string> = { vercel: 'token', neon: 'apiKey' };

export const FIELD_SPECS: Record<PlatformProviderId, PlatformConfigFieldSpec[]> = {
  vercel: [
    {
      key: 'token',
      label: 'Access Token',
      placeholder: 'vercel_xxxxxxxx',
      hint: 'Vercel → Account Settings → Tokens 创建。Token 只在服务端使用，保存后不会回显。',
      required: true,
      secret: true,
    },
    {
      key: 'teamId',
      label: 'Team ID（可选）',
      placeholder: 'team_xxxxxxxx',
      hint: '个人账户留空；团队账户填写后可读取该团队的用量。',
      required: false,
      secret: false,
    },
  ],
  neon: [
    {
      key: 'apiKey',
      label: 'API Key',
      placeholder: 'napi_xxxxxxxx',
      hint: 'Neon Console → Account settings → API keys 创建，建议使用不过期的密钥。',
      required: true,
      secret: true,
    },
    {
      key: 'organizationId',
      label: 'Organization ID（可选）',
      placeholder: 'org-xxxxxxxx',
      hint: '只属于一个组织时可以留空，系统会自动识别。',
      required: false,
      secret: false,
    },
    {
      key: 'projectId',
      label: 'Project ID（可选）',
      placeholder: 'xxxxxxxx-123456',
      hint: '留空则检查前若干个项目，按用量最高的那个计算百分比。',
      required: false,
      secret: false,
    },
  ],
};

/**
 * 刷新冷却：60 秒。比系统状态面板的 10 秒轮询长得多，避免误触把免费额度耗光；
 * 足够短，管理员配置完能立刻验证一次。
 */
export const REFRESH_COOLDOWN_MS = 60_000;

export function providerEnabled(environment: PlatformEnvironment, provider: PlatformProviderId): boolean {
  return provider === 'vercel' ? environment.vercel : environment.neon;
}

function bodyOf(req: VercelRequest): Record<string, unknown> {
  const raw: unknown = req.body;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function parseMetrics(value: unknown): PlatformMetric[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? (() => {
          try {
            const parsed: unknown = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];
  const metrics: PlatformMetric[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.key !== 'string' || typeof record.label !== 'string') continue;
    if (typeof record.used !== 'number' || !Number.isFinite(record.used)) continue;
    const limit = typeof record.limit === 'number' && Number.isFinite(record.limit) ? record.limit : null;
    metrics.push({
      key: record.key,
      label: record.label,
      used: record.used,
      limit,
      unit: typeof record.unit === 'string' ? record.unit : '',
      percent: typeof record.percent === 'number' && Number.isFinite(record.percent) ? record.percent : null,
      note: typeof record.note === 'string' && record.note ? record.note : undefined,
    });
  }
  return metrics;
}

const KNOWN_STATUSES: readonly PlatformStatus[] = [
  'ok',
  'warning',
  'critical',
  'unconfigured',
  'unsupported',
  'credential_error',
  'rate_limited',
  'error',
];

function toSnapshot(provider: PlatformProviderId, stored: StoredPlatformSnapshot): PlatformProviderSnapshot {
  const status = KNOWN_STATUSES.includes(stored.status) ? stored.status : 'error';
  return {
    provider,
    label: LABELS[provider],
    status,
    message: stored.message,
    observedAt: stored.observedAt,
    periodStart: stored.periodStart,
    periodEnd: stored.periodEnd,
    metrics: parseMetrics(stored.metrics),
    consoleUrl: stored.consoleUrl || CONSOLE_URLS[provider],
    source: stored.source,
    accountLabel: stored.accountLabel,
    stale: stored.stale,
  };
}

async function buildProviderView(provider: PlatformProviderId, enabled: boolean): Promise<PlatformProviderView> {
  if (!enabled) {
    return {
      provider,
      enabled: false,
      configured: false,
      hint: null,
      updatedAt: null,
      fields: FIELD_SPECS[provider],
      consoleUrl: CONSOLE_URLS[provider],
      snapshot: null,
    };
  }
  const [stored, snapshot] = await Promise.all([readPlatformConfig(provider), readPlatformSnapshot(provider)]);
  const configured = Boolean(stored && Object.keys(stored.fields).length > 0);
  return {
    provider,
    enabled: true,
    configured,
    hint: configured ? stored?.hint || null : null,
    updatedAt: stored?.updatedAt ?? null,
    fields: FIELD_SPECS[provider],
    consoleUrl: snapshot?.consoleUrl || CONSOLE_URLS[provider],
    // 未配置时不回放历史快照，避免清除凭据后仍显示旧数字。
    snapshot: configured && snapshot ? toSnapshot(provider, snapshot) : null,
  };
}

export async function buildPlatformUsagePayload(): Promise<PlatformUsagePayload> {
  const environment = detectPlatformEnvironment();
  const providers: PlatformProviderView[] = [];
  for (const provider of ['vercel', 'neon'] as const) {
    const enabled = providerEnabled(environment, provider);
    if (!enabled) continue;
    providers.push(await buildProviderView(provider, true));
  }
  return {
    ok: true,
    environment: { runtime: environment.runtime, database: environment.database, local: environment.local },
    providers,
  };
}

async function requireSuperAdmin(req: VercelRequest, res: VercelResponse) {
  const actor = await requireActor(req, res);
  if (!actor) return null;
  if (!actor.permissions.includes('*')) {
    res.status(403).json({ ok: false, code: 'PERMISSION_DENIED', error: '仅超级管理员可查看平台额度' });
    return null;
  }
  return actor;
}

async function selfMeasuredDatabaseBytes(): Promise<number | null> {
  try {
    const rows = await authSql()`SELECT pg_database_size(current_database())::bigint AS size`;
    const raw = rows[0]?.size;
    const value = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function handlePlatformUsage(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' });
    return;
  }
  const actor = await requireSuperAdmin(req, res);
  if (!actor) return;
  try {
    res.json(await buildPlatformUsagePayload());
  } catch (error) {
    sendDatabaseError(req, res, error, 'read');
  }
}

export async function handlePlatformUsageConfig(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' });
    return;
  }
  const actor = await requireSuperAdmin(req, res);
  if (!actor) return;

  const body = bodyOf(req);
  const provider = body.provider;
  if (!isPlatformProviderId(provider)) {
    res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: '未知的平台标识' });
    return;
  }
  const environment = detectPlatformEnvironment();
  if (!providerEnabled(environment, provider)) {
    res.status(400).json({ ok: false, code: 'PLATFORM_DISABLED', error: '当前部署未启用该平台' });
    return;
  }

  try {
    await ensurePlatformUsageTables();
    if (body.action === 'clear') {
      await clearPlatformConfig(provider);
      res.json(await buildPlatformUsagePayload());
      return;
    }

    const rawValues = body.values;
    const values =
      rawValues && typeof rawValues === 'object' && !Array.isArray(rawValues)
        ? (rawValues as Record<string, unknown>)
        : {};
    const specs = FIELD_SPECS[provider];
    const provided = specs.filter((spec) => Object.prototype.hasOwnProperty.call(values, spec.key));
    if (!provided.length) {
      res.status(400).json({ ok: false, code: 'NO_FIELDS', error: '没有需要保存的字段' });
      return;
    }

    const secret = await encryptionSecret();
    const existing = await readPlatformConfig(provider);
    const fields: Record<string, string> = { ...(existing?.fields ?? {}) };

    for (const spec of provided) {
      const raw = String(values[spec.key] ?? '').trim();
      if (!raw) {
        if (!spec.required) delete fields[spec.key];
        continue;
      }
      if (raw.length > 4096) {
        res.status(400).json({ ok: false, code: 'FIELD_TOO_LONG', error: `${spec.label} 过长` });
        return;
      }
      fields[spec.key] = encryptSecret(raw, secret);
    }

    for (const spec of specs) {
      if (spec.required && !fields[spec.key]) {
        res.status(400).json({ ok: false, code: 'FIELD_REQUIRED', error: `请填写${spec.label}` });
        return;
      }
    }

    const secretPlain = decryptSecret(fields[SECRET_FIELD[provider]] ?? '', secret) ?? '';
    await writePlatformConfig(provider, fields, secretHint(secretPlain), actor.id);
    res.json(await buildPlatformUsagePayload());
  } catch (error) {
    sendDatabaseError(req, res, error, 'write');
  }
}

function mergeWithPrevious(
  current: PlatformProviderSnapshot,
  previous: StoredPlatformSnapshot | null,
): Omit<StoredPlatformSnapshot, 'updatedAt'> {
  // 本次没有拿到新读数（失败/限流/不支持）时，保留上一次成功读数并标记过期。
  if (current.observedAt == null && previous && previous.observedAt != null && previous.status !== 'unsupported') {
    const carried = parseMetrics(previous.metrics);
    if (carried.length) {
      return {
        status: current.status,
        message: current.message,
        observedAt: previous.observedAt,
        periodStart: previous.periodStart,
        periodEnd: previous.periodEnd,
        metrics: carried,
        consoleUrl: current.consoleUrl || previous.consoleUrl,
        source: previous.source || current.source,
        accountLabel: current.accountLabel ?? previous.accountLabel,
        stale: true,
      };
    }
  }
  return {
    status: current.status,
    message: current.message,
    observedAt: current.observedAt,
    periodStart: current.periodStart,
    periodEnd: current.periodEnd,
    metrics: current.metrics,
    consoleUrl: current.consoleUrl,
    source: current.source,
    accountLabel: current.accountLabel,
    stale: false,
  };
}

export async function handlePlatformUsageRefresh(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' });
    return;
  }
  const actor = await requireSuperAdmin(req, res);
  if (!actor) return;

  const body = bodyOf(req);
  const provider = body.provider;
  if (!isPlatformProviderId(provider)) {
    res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: '未知的平台标识' });
    return;
  }
  const environment = detectPlatformEnvironment();
  if (!providerEnabled(environment, provider)) {
    res.status(400).json({ ok: false, code: 'PLATFORM_DISABLED', error: '当前部署未启用该平台' });
    return;
  }

  try {
    const stored = await readPlatformConfig(provider);
    if (!stored || !Object.keys(stored.fields).length) {
      res.status(400).json({ ok: false, code: 'NOT_CONFIGURED', error: '请先完成平台凭据设置' });
      return;
    }

    const previous = await readPlatformSnapshot(provider);
    const now = Date.now();
    if (previous && previous.updatedAt > 0 && now - previous.updatedAt < REFRESH_COOLDOWN_MS) {
      const retryAfterSeconds = Math.max(1, Math.ceil((REFRESH_COOLDOWN_MS - (now - previous.updatedAt)) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res
        .status(429)
        .json({ ok: false, code: 'REFRESH_TOO_SOON', error: '刷新过于频繁，请稍后再试', retryAfterSeconds });
      return;
    }

    const secret = await encryptionSecret();
    const plain = (key: string): string | null => {
      const encrypted = stored.fields[key];
      if (!encrypted) return null;
      return decryptSecret(encrypted, secret);
    };

    let snapshot: PlatformProviderSnapshot;
    if (provider === 'vercel') {
      const token = plain('token');
      if (!token) {
        res.status(400).json({ ok: false, code: 'CREDENTIAL_UNREADABLE', error: 'Vercel Token 无法解密，请重新填写' });
        return;
      }
      snapshot = await collectVercelUsage({ token, teamId: plain('teamId') ?? undefined, now });
    } else {
      const apiKey = plain('apiKey');
      if (!apiKey) {
        res.status(400).json({ ok: false, code: 'CREDENTIAL_UNREADABLE', error: 'Neon API Key 无法解密，请重新填写' });
        return;
      }
      snapshot = await collectNeonUsage({
        apiKey,
        organizationId: plain('organizationId') ?? undefined,
        projectId: plain('projectId') ?? undefined,
        selfMeasuredStorageBytes: await selfMeasuredDatabaseBytes(),
        now,
      });
    }

    await writePlatformSnapshot(provider, mergeWithPrevious(snapshot, previous));
    res.json(await buildPlatformUsagePayload());
  } catch (error) {
    sendDatabaseError(req, res, error, 'write');
  }
}
