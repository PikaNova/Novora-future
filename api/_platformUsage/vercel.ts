// Vercel 免费（Hobby）额度适配器。
//
// `/v2/usage` 是未公开端点，参数与响应形状由 2026-10-01 用真实账号逐项实测确定：
//
//   GET /v2/usage?type=<type>&from=<ISO>&to=<ISO>[&teamId=|&slug=]
//
//   - `type` 与 `from` 必填；缺 `type` 时返回 400，错误信息里带完整枚举。
//   - 只有 `type=requests` 会返回我们要的字段（monitoring / edge / builds 等对大多数
//     账户是空数组），响应形如 `{ granularity, lastUpdate, data: [ {…按天分桶…} ] }`。
//   - 每个桶里有 `bandwidth_outgoing_bytes`、`function_execution_*_gb_hours` 等累加值，
//     必须对窗口内所有桶求和，取第一条会严重低估。
//   - 该端点不返回 Active CPU，因此那一条只显示官方额度、不给百分比。
import { statusFromMetrics, type PlatformMetric, type PlatformProviderSnapshot } from './types.js';

const API_BASE = 'https://api.vercel.com';
const CONSOLE_URL = 'https://vercel.com/dashboard/usage';
const WINDOW_DAYS = 30;
const GB = 1_000_000_000;

/** 唯一会返回用量字段的 type（已逐一实测其余取值）。 */
export const VERCEL_USAGE_TYPE = 'requests';

/** Hobby 免费额度，取自官方 Hobby 文档（2026-10 核对）。 */
export const VERCEL_HOBBY_LIMITS = {
  fastDataTransferGb: 100,
  activeCpuHours: 4,
  provisionedMemoryGbHours: 360,
};

/** 需要按窗口求和的字节字段：CDN 传出去的量就是 Fast Data Transfer。 */
export const VERCEL_BYTE_FIELDS = ['bandwidth_outgoing_bytes'] as const;

/** 需要按窗口求和的 GB-小时字段：函数实例占用内存的总时长。 */
export const VERCEL_GB_HOUR_FIELDS = [
  'function_execution_successful_gb_hours',
  'function_execution_error_gb_hours',
  'function_execution_timeout_gb_hours',
] as const;

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** 对分桶数组里指定字段求和；非数值与缺失字段按 0 处理，不抛错。 */
export function sumBuckets(data: unknown, fields: readonly string[]): number {
  if (!Array.isArray(data)) return 0;
  let total = 0;
  for (const bucket of data) {
    if (!bucket || typeof bucket !== 'object') continue;
    const record = bucket as Record<string, unknown>;
    for (const field of fields) {
      const value = toNumber(record[field]);
      if (value != null) total += value;
    }
  }
  return total;
}

/** 只描述结构骨架（键名与类型，不含数值），用于遇到未知响应时把形状回显到面板上。 */
export function describeShape(node: unknown, depth = 0): string {
  if (depth > 3) return '…';
  if (node === null) return 'null';
  if (Array.isArray(node)) return node.length ? `[${describeShape(node[0], depth + 1)}]` : '[]';
  if (typeof node === 'object') {
    const entries = Object.entries(node as Record<string, unknown>);
    if (!entries.length) return '{}';
    const shown = entries.slice(0, 12).map(([key, value]) => `${key}: ${describeShape(value, depth + 1)}`);
    return `{ ${shown.join(', ')}${entries.length > 12 ? ', …' : ''} }`;
  }
  return typeof node;
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function percentOf(used: number, limit: number): number | null {
  if (!Number.isFinite(limit) || limit <= 0) return null;
  return round((used / limit) * 100, 2);
}

/** 没有读数时展示官方额度，但不给百分比。 */
export function vercelDeclarativeMetrics(): PlatformMetric[] {
  return [
    {
      key: 'fast_data_transfer',
      label: 'Fast Data Transfer',
      used: 0,
      limit: VERCEL_HOBBY_LIMITS.fastDataTransferGb,
      unit: 'GB',
      percent: null,
    },
    {
      key: 'active_cpu',
      label: 'Active CPU',
      used: 0,
      limit: VERCEL_HOBBY_LIMITS.activeCpuHours,
      unit: 'CPU-hrs',
      percent: null,
    },
    {
      key: 'provisioned_memory',
      label: 'Provisioned Memory',
      used: 0,
      limit: VERCEL_HOBBY_LIMITS.provisionedMemoryGbHours,
      unit: 'GB-hrs',
      percent: null,
    },
  ];
}

/**
 * 把 `type=requests` 的分桶数组换算成额度读数。
 *
 * Active CPU 不在这里出现：该端点不返回它，与其显示一个「0 / 4」让人误以为没用量，
 * 不如把它交给提示文案说明。
 */
export function buildVercelMetrics(data: unknown): PlatformMetric[] {
  const outgoingBytes = sumBuckets(data, VERCEL_BYTE_FIELDS);
  const gbHours = sumBuckets(data, VERCEL_GB_HOUR_FIELDS);
  const usedGb = outgoingBytes / GB;
  return [
    {
      key: 'fast_data_transfer',
      label: 'Fast Data Transfer',
      used: round(usedGb, 3),
      limit: VERCEL_HOBBY_LIMITS.fastDataTransferGb,
      unit: 'GB',
      percent: percentOf(usedGb, VERCEL_HOBBY_LIMITS.fastDataTransferGb),
    },
    {
      key: 'provisioned_memory',
      label: 'Provisioned Memory',
      used: round(gbHours, 3),
      limit: VERCEL_HOBBY_LIMITS.provisionedMemoryGbHours,
      unit: 'GB-hrs',
      percent: percentOf(gbHours, VERCEL_HOBBY_LIMITS.provisionedMemoryGbHours),
    },
  ];
}

export type VercelCollectInput = {
  token: string;
  /** 团队作用域：Team ID（`team_…`）或团队 slug。个人账户可留空。 */
  teamId?: string;
  now?: number;
};

/** 把 `{ error: { message } }` 读出来，让报错带上平台原话。 */
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

const NO_ACTIVE_CPU_NOTE = '该接口未返回 Active CPU，请到 Vercel 用量页查看。';

export async function collectVercelUsage(input: VercelCollectInput): Promise<PlatformProviderSnapshot> {
  const now = input.now ?? Date.now();
  const from = new Date(now - WINDOW_DAYS * 86_400_000).toISOString();
  const to = new Date(now).toISOString();
  const scope = input.teamId?.trim() ?? '';

  const base: PlatformProviderSnapshot = {
    provider: 'vercel',
    label: 'Vercel',
    status: 'unsupported',
    message: '',
    observedAt: null,
    periodStart: from,
    periodEnd: to,
    metrics: vercelDeclarativeMetrics(),
    consoleUrl: CONSOLE_URL,
    source: 'vercel-api',
    accountLabel: scope || null,
    stale: false,
  };

  const params = new URLSearchParams({ type: VERCEL_USAGE_TYPE, from, to });
  // `team_` 开头按 Team ID 传，否则按 slug 传——两者在 Vercel 是分开的参数。
  if (scope) params.set(scope.startsWith('team_') ? 'teamId' : 'slug', scope);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/v2/usage?${params.toString()}`, {
      headers: { Authorization: `Bearer ${input.token}`, Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (error) {
    return {
      ...base,
      status: 'error',
      message: `Vercel 用量接口请求失败：${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    return { ...base, status: 'credential_error', message: 'Vercel Token 无效或权限不足，请重新填写。' };
  }
  if (response.status === 429) {
    return { ...base, status: 'rate_limited', message: 'Vercel 接口触发限流，请稍后再试。' };
  }
  if (!response.ok) {
    return { ...base, status: 'error', message: `Vercel 用量接口报错：${await readApiError(response)}` };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ...base, status: 'unsupported', message: 'Vercel 用量接口返回的内容无法解析。' };
  }

  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    return {
      ...base,
      status: 'unsupported',
      message: `Vercel 返回了未知结构：${describeShape(payload).slice(0, 300)}`,
    };
  }
  if (!data.length) {
    return {
      ...base,
      status: 'unsupported',
      message: 'Vercel 返回的用量列表为空：近 30 天没有可用记录，请到 Vercel 用量页核对团队与计费周期。',
    };
  }

  const metrics = buildVercelMetrics(data);
  return {
    ...base,
    status: statusFromMetrics(metrics),
    message: `数据来自 Vercel 用量接口（${data.length} 个日桶累加），可能有一小时左右延迟。${NO_ACTIVE_CPU_NOTE}`,
    observedAt: now,
    metrics,
  };
}
