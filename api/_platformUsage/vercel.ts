// Vercel 免费（Hobby）额度适配器。
//
// 重要事实：Vercel 官方 OpenAPI 规范里没有用量端点，`/v2/usage` 是未公开路由
// （无凭据返回 400，而需要鉴权的已知端点返回 403）。因此这里采取「保守解析」：
// 只有在响应里同时拿到可识别的指标名和可识别的单位时才给出数字，否则一律回落为
// unsupported，只展示官方额度与控制台入口，不猜、不换算不明单位。
import { statusFromMetrics, type PlatformMetric, type PlatformProviderSnapshot } from './types.js';

const API_BASE = 'https://api.vercel.com';
const CONSOLE_URL = 'https://vercel.com/dashboard/usage';
const WINDOW_DAYS = 30;
const GB = 1_000_000_000;

/**
 * `/v2/usage` 是未公开端点，但它的参数约束可以从报错里读出来：
 * `type` 必填，允许值为 requests / monitoring / builds / edge / edge_group_by_project /
 * artifacts / edge_config / log_drains / storage_postgres / storage_redis / storage_blob /
 * cron_jobs / data_cache（2026-10-01 实测）；`from` 必填。
 *
 * 与 Hobby 那三项额度最相关的两类是 monitoring（函数：Active CPU / Provisioned Memory）
 * 和 edge（CDN：Fast Data Transfer）。按此顺序查询，同名指标取先命中的那个，不做累加，
 * 避免同一份用量被两类响应重复计数。
 */
export const VERCEL_USAGE_TYPES = ['monitoring', 'edge'] as const;

type LimitSpec = {
  key: string;
  label: string;
  namePattern: RegExp;
  limit: number;
  unit: string;
  /** 目标单位：字节或秒。 */
  dimension: 'bytes' | 'seconds';
};

/** 额度来自官方 Hobby 文档（2026-10 核对：Fast Data Transfer 100 GB、Active CPU 4 CPU-hrs、
 *  Provisioned Memory 360 GB-hrs）。文档里已不再列 Edge Requests 这一项。 */
const HOBBY_LIMITS: LimitSpec[] = [
  {
    key: 'fast_data_transfer',
    label: 'Fast Data Transfer',
    namePattern: /fast[\s_-]?data[\s_-]?transfer|datatransfer/i,
    limit: 100 * GB,
    unit: 'GB',
    dimension: 'bytes',
  },
  {
    key: 'active_cpu',
    label: 'Active CPU',
    namePattern: /active[\s_-]?cpu/i,
    limit: 4 * 3600,
    unit: 'CPU-hrs',
    dimension: 'seconds',
  },
  {
    key: 'provisioned_memory',
    label: 'Provisioned Memory',
    namePattern: /provisioned[\s_-]?memory/i,
    limit: 360 * 3600,
    unit: 'GB-hrs',
    dimension: 'seconds',
  },
];

const BYTE_UNITS: Record<string, number> = {
  b: 1,
  byte: 1,
  bytes: 1,
  kb: 1_000,
  mb: 1_000_000,
  gb: GB,
  tb: GB * 1_000,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
};

const SECOND_UNITS: Record<string, number> = {
  s: 1,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  m: 60,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  h: 3600,
  hr: 3600,
  hrs: 3600,
  hour: 3600,
  hours: 3600,
};

type NamedUsage = { name: string; value: number; unit: string | null };

/** 内层承载数值的常见字段名。 */
const NUMERIC_FIELDS = ['value', 'total', 'usage', 'count', 'amount', 'used', 'current', 'quantity'] as const;

/**
 * 按「对象键名」识别指标。
 *
 * 未公开端点不一定把指标名放在 `name` 字段里——也可能直接是键名，例如
 * `{ activeCpu: { value: 2, unit: "hours" } }`。这里把数值型键名也收集进来，
 * 复用它最近的 `unit` 字段；单位仍然必须在 normalizeUsage 里被认出来才算数，
 * 所以不会因为键名像就凭空造数字。
 */
export function collectKeyedUsage(node: unknown, out: NamedUsage[], depth = 0, unitHint: string | null = null): void {
  if (depth > 8 || node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) collectKeyedUsage(item, out, depth + 1, unitHint);
    return;
  }
  if (typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  const localUnit = typeof record.unit === 'string' && record.unit.trim() ? record.unit.trim() : unitHint;
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      out.push({ name: key, value, unit: localUnit });
      continue;
    }
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      out.push({ name: key, value: Number(value), unit: localUnit });
      continue;
    }
    // `{ activeCpu: { value: 2, unit: "hours" } }`：指标名是父级键，数值取内层字段。
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const inner = value as Record<string, unknown>;
      const innerUnit = typeof inner.unit === 'string' && inner.unit.trim() ? inner.unit.trim() : localUnit;
      const hit = NUMERIC_FIELDS.find((field) => typeof inner[field] === 'number' && Number.isFinite(inner[field]));
      if (hit) {
        out.push({ name: key, value: Number(inner[hit]), unit: innerUnit });
        continue;
      }
    }
    collectKeyedUsage(value, out, depth + 1, localUnit);
  }
}

/**
 * 只描述「结构骨架」——键名和类型，不含任何数值——用于解析失败时把响应形状
 * 直接回显到面板上，省掉一轮「加日志 → 重新部署 → 导出日志」的来回。
 */
export function describeShape(node: unknown, depth = 0): string {
  if (depth > 3) return '…';
  if (node === null) return 'null';
  if (Array.isArray(node)) return node.length ? `[${describeShape(node[0], depth + 1)}]` : '[]';
  if (typeof node === 'object') {
    const keys = Object.keys(node as Record<string, unknown>);
    if (!keys.length) return '{}';
    const shown = keys
      .slice(0, 12)
      .map((key) => `${key}: ${describeShape((node as Record<string, unknown>)[key], depth + 1)}`);
    return `{ ${shown.join(', ')}${keys.length > 12 ? ', …' : ''} }`;
  }
  return typeof node;
}

export function collectNamedUsage(node: unknown, out: NamedUsage[], depth = 0): void {
  if (depth > 8 || node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) collectNamedUsage(item, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  const record = node as Record<string, unknown>;

  let name: string | null = null;
  for (const key of ['name', 'type', 'metric', 'key', 'slug', 'resource']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      name = value.trim();
      break;
    }
  }
  let value: number | null = null;
  for (const key of ['value', 'total', 'usage', 'count', 'amount', 'used', 'current', 'quantity']) {
    const raw = record[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      value = raw;
      break;
    }
    if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
      value = Number(raw);
      break;
    }
  }
  let unit: string | null = null;
  for (const key of ['unit', 'units', 'unitType', 'measure']) {
    const raw = record[key];
    if (typeof raw === 'string' && raw.trim()) {
      unit = raw.trim();
      break;
    }
  }
  if (name && value != null) out.push({ name, value, unit });

  for (const child of Object.values(record)) collectNamedUsage(child, out, depth + 1);
}

/** 把带单位的读数换算到目标维度；单位无法识别时返回 null（宁可不显示，也不猜）。 */
export function normalizeUsage(entry: NamedUsage, dimension: 'bytes' | 'seconds'): number | null {
  const rawUnit = (entry.unit ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (dimension === 'bytes') {
    const factor = BYTE_UNITS[rawUnit];
    if (factor == null) return null;
    return entry.value * factor;
  }
  const factor = SECOND_UNITS[rawUnit];
  if (factor == null) return null;
  return entry.value * factor;
}

function pickMetric(spec: LimitSpec, entries: NamedUsage[]): PlatformMetric | null {
  const matches = entries.filter((entry) => spec.namePattern.test(entry.name));
  if (!matches.length) return null;
  for (const entry of matches) {
    const normalized = normalizeUsage(entry, spec.dimension);
    if (normalized == null) continue;
    const used = spec.dimension === 'bytes' ? normalized / GB : normalized / 3600;
    const limit = spec.dimension === 'bytes' ? spec.limit / GB : spec.limit / 3600;
    return {
      key: spec.key,
      label: spec.label,
      used: Number(used.toFixed(3)),
      limit: Number(limit.toFixed(3)),
      unit: spec.unit,
      percent: limit > 0 ? Number(((used / limit) * 100).toFixed(1)) : null,
    };
  }
  return null;
}

function declarativeMetrics(): PlatformMetric[] {
  return HOBBY_LIMITS.map((spec) => ({
    key: spec.key,
    label: spec.label,
    used: 0,
    limit: spec.dimension === 'bytes' ? spec.limit / GB : spec.limit / 3600,
    unit: spec.unit,
    percent: null,
  }));
}

export type VercelCollectInput = {
  token: string;
  teamId?: string;
  now?: number;
};

/** 把 `{ error: { message } }` 读出来，让 400 之类的报错带上平台原话。 */
async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown }; message?: unknown };
    const message = body?.error?.message ?? body?.message;
    if (typeof message === 'string' && message) return message.slice(0, 200);
  } catch {
    /* 无 JSON 响应体 */
  }
  return `HTTP ${response.status}`;
}

export async function collectVercelUsage(input: VercelCollectInput): Promise<PlatformProviderSnapshot> {
  const now = input.now ?? Date.now();
  const from = new Date(now - WINDOW_DAYS * 86_400_000).toISOString();
  const to = new Date(now).toISOString();

  const base: PlatformProviderSnapshot = {
    provider: 'vercel',
    label: 'Vercel',
    status: 'unsupported',
    message: '',
    observedAt: null,
    periodStart: from,
    periodEnd: to,
    metrics: declarativeMetrics(),
    consoleUrl: CONSOLE_URL,
    source: 'vercel-api',
    accountLabel: input.teamId ? `team ${input.teamId}` : null,
    stale: false,
  };

  const entries: NamedUsage[] = [];
  const payloads: unknown[] = [];
  const problems: string[] = [];
  let rateLimited = false;

  for (const type of VERCEL_USAGE_TYPES) {
    const params = new URLSearchParams({ type, from, to });
    if (input.teamId) params.set('teamId', input.teamId);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/v2/usage?${params.toString()}`, {
        headers: { Authorization: `Bearer ${input.token}`, Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (error) {
      problems.push(`${type}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      return { ...base, status: 'credential_error', message: 'Vercel Token 无效或权限不足，请重新填写。' };
    }
    if (response.status === 429) {
      rateLimited = true;
      continue;
    }
    if (!response.ok) {
      problems.push(`${type}: ${await readApiError(response)}`);
      continue;
    }

    try {
      payloads.push(await response.json());
    } catch {
      problems.push(`${type}: 响应无法解析`);
    }
  }

  for (const payload of payloads) {
    collectNamedUsage(payload, entries);
    collectKeyedUsage(payload, entries);
  }

  const metrics: PlatformMetric[] = [];
  for (const spec of HOBBY_LIMITS) {
    const metric = pickMetric(spec, entries);
    if (metric) metrics.push(metric);
  }

  if (!metrics.length) {
    if (rateLimited && !problems.length) {
      return { ...base, status: 'rate_limited', message: 'Vercel 接口触发限流，请稍后再试。' };
    }
    return {
      ...base,
      status: problems.length ? 'error' : 'unsupported',
      message: problems.length
        ? `Vercel 用量接口未返回可识别数据（${problems.join('；')}）。`
        : `Vercel 返回的数据里没有可识别的用量字段。响应结构：${payloads
            .map((payload) => describeShape(payload))
            .join(' ')
            .slice(0, 400)}`,
    };
  }

  const partial = metrics.length < HOBBY_LIMITS.length;
  return {
    ...base,
    status: statusFromMetrics(metrics),
    message: partial
      ? '只识别到部分指标，其余请到 Vercel 用量页核对。'
      : '数据来自 Vercel 用量接口，可能有一小时左右延迟。',
    observedAt: now,
    metrics,
  };
}

export const VERCEL_HOBBY_LIMITS = HOBBY_LIMITS;
export { declarativeMetrics as vercelDeclarativeMetrics };
