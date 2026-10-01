// Neon 免费计划额度适配器。
//
// 事实边界（已核对官方文档）：
// - `consumption_history/v2/projects` 这类按时间粒度的历史接口只对付费计划开放，
//   这里完全不使用；
// - `GET /projects/{project_id}` 的响应里带当前计费周期的用量字段
//   （active_time_seconds / compute_time_seconds / written_data_bytes /
//   data_transfer_bytes / consumption_period_start / consumption_period_end），
//   官方没有标注计划限制，这是唯一可能读到当期用量的官方路径。
//
// 但官方也没有承诺免费计划一定填充这些字段。因此本适配器的定位是「尽力而为」：
// 读到了就展示，读不到（报错或全为 0）就退回「只显示官方额度 + 控制台入口」，
// 绝不用估算值冒充真实读数。存储这一项另有来自我们自己数据库的自测值兜底。
import { statusFromMetrics, type PlatformMetric, type PlatformProviderSnapshot } from './types.js';

const API_BASE = 'https://console.neon.tech/api/v2';
const CONSOLE_BASE = 'https://console.neon.tech/app/projects';
const GB = 1_000_000_000;

/** Neon Free 文档额度：100 CU-hours/项目/月、0.5 GB/项目、5 GB 公网传输/项目/月。 */
export const NEON_FREE_LIMITS = {
  computeCuHours: 100,
  storageBytes: 500_000_000,
  transferBytes: 5_000_000_000,
};

/** 单次刷新最多检查的项目数，避免把免费版的请求额度吃光。 */
const MAX_PROJECTS = 5;

/** 失败分支。用显式类型谓词收窄：本仓库 api 的 tsconfig 未开 strictNullChecks，
 *  仅靠 `ok: true/false` 字面量判别时编译器不保证收窄。 */
type Failure = { ok: false; status: number; message: string };
type NeonResponse<T> = { ok: true; data: T } | Failure;
type OrganizationResult = { ok: true; id: string } | Failure;

function isFailure(value: NeonResponse<unknown> | OrganizationResult): value is Failure {
  return value.ok === false;
}

async function neonGet<T>(path: string, apiKey: string): Promise<NeonResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = `Neon API 返回 HTTP ${response.status}`;
      try {
        const body = (await response.json()) as { message?: unknown };
        if (typeof body?.message === 'string' && body.message) message = body.message;
      } catch {
        /* 保留默认信息 */
      }
      return { ok: false, status: response.status, message };
    }
    return { ok: true, data: (await response.json()) as T };
  } catch (error) {
    return { ok: false, status: 0, message: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export type NeonProjectUsage = {
  projectId: string;
  name: string;
  computeSeconds: number;
  transferBytes: number;
  writtenBytes: number;
  storageBytes: number | null;
  periodStart: string | null;
  periodEnd: string | null;
};

export type NeonCollectInput = {
  apiKey: string;
  organizationId?: string;
  projectId?: string;
  /** 来自我们自己数据库的自测存储大小；分支数据不可用时用它兜底。 */
  selfMeasuredStorageBytes?: number | null;
  now?: number;
};

function toIso(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function organizationFromList(value: unknown): OrganizationResult {
  const list = Array.isArray(value) ? value : [];
  const ids = list
    .map((item) => asRecord(item).id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (ids.length === 1) return { ok: true, id: ids[0] };
  if (ids.length === 0) return { ok: false, status: 0, message: '该 API Key 下没有可访问的 Neon 组织。' };
  return { ok: false, status: 0, message: '该 API Key 可访问多个组织，请在设置里指定组织 ID。' };
}

async function resolveOrganization(apiKey: string, configured?: string): Promise<OrganizationResult> {
  if (configured) return { ok: true, id: configured };

  const personal = await neonGet<{ organizations?: unknown }>('/users/me/organizations', apiKey);
  if (!isFailure(personal)) return organizationFromList(personal.data.organizations);

  const scoped = await neonGet<{ organizations?: unknown }>('/organizations', apiKey);
  if (!isFailure(scoped)) return organizationFromList(scoped.data.organizations);

  return { ok: false, status: personal.status, message: personal.message };
}

async function readProjectUsage(
  apiKey: string,
  projectId: string,
  selfMeasuredStorageBytes: number | null | undefined,
): Promise<NeonProjectUsage | { error: string }> {
  const detail = await neonGet<{ project?: unknown }>(`/projects/${encodeURIComponent(projectId)}`, apiKey);
  if (isFailure(detail)) return { error: detail.message };
  const project = asRecord(detail.data.project);

  // 分支逻辑大小之和才是「当前存储」；单项缺失按未知处理，不按 0 处理。
  let storageBytes: number | null = null;
  const branches = await neonGet<{ branches?: unknown }>(`/projects/${encodeURIComponent(projectId)}/branches`, apiKey);
  if (!isFailure(branches)) {
    const list = Array.isArray(branches.data.branches) ? branches.data.branches : [];
    let total = 0;
    let known = 0;
    for (const item of list) {
      const size = numeric(asRecord(item).logical_size);
      if (size != null) {
        total += size;
        known += 1;
      }
    }
    if (known > 0) storageBytes = total;
  }
  if (storageBytes == null && typeof selfMeasuredStorageBytes === 'number' && selfMeasuredStorageBytes > 0) {
    storageBytes = selfMeasuredStorageBytes;
  }

  return {
    projectId,
    name: typeof project.name === 'string' && project.name ? project.name : projectId,
    computeSeconds: numeric(project.compute_time_seconds) ?? 0,
    transferBytes: numeric(project.data_transfer_bytes) ?? 0,
    writtenBytes: numeric(project.written_data_bytes) ?? 0,
    storageBytes,
    periodStart: toIso(project.consumption_period_start),
    periodEnd: toIso(project.consumption_period_end),
  };
}

function worstMetric(
  key: string,
  label: string,
  unit: string,
  limit: number,
  readings: Array<{ project: string; used: number }>,
): PlatformMetric | null {
  if (!readings.length) return null;
  let worst = readings[0];
  for (const reading of readings) if (reading.used > worst.used) worst = reading;
  const used = Number(worst.used.toFixed(3));
  const roundedLimit = Number(limit.toFixed(3));
  return {
    key,
    label,
    used,
    limit: roundedLimit,
    unit,
    percent: roundedLimit > 0 ? Number(((used / roundedLimit) * 100).toFixed(1)) : null,
    note: readings.length > 1 ? `最高：${worst.project}` : undefined,
  };
}

function declarativeMetrics(): PlatformMetric[] {
  return [
    {
      key: 'compute',
      label: 'Compute',
      used: 0,
      limit: NEON_FREE_LIMITS.computeCuHours,
      unit: 'CU-hrs',
      percent: null,
    },
    {
      key: 'storage',
      label: 'Storage',
      used: 0,
      limit: NEON_FREE_LIMITS.storageBytes / GB,
      unit: 'GB',
      percent: null,
    },
    {
      key: 'egress',
      label: 'Public network transfer',
      used: 0,
      limit: NEON_FREE_LIMITS.transferBytes / GB,
      unit: 'GB',
      percent: null,
    },
  ];
}

export async function collectNeonUsage(input: NeonCollectInput): Promise<PlatformProviderSnapshot> {
  const now = input.now ?? Date.now();
  const base: PlatformProviderSnapshot = {
    provider: 'neon',
    label: 'Neon',
    status: 'unsupported',
    message: '',
    observedAt: null,
    periodStart: null,
    periodEnd: null,
    metrics: declarativeMetrics(),
    consoleUrl: input.projectId
      ? `${CONSOLE_BASE}/${encodeURIComponent(input.projectId)}`
      : 'https://console.neon.tech',
    source: 'neon-api',
    accountLabel: input.organizationId ?? null,
    stale: false,
  };

  const organization = await resolveOrganization(input.apiKey, input.organizationId);
  if (isFailure(organization)) {
    if (organization.status === 401 || organization.status === 403) {
      return { ...base, status: 'credential_error', message: 'Neon API Key 无效或权限不足，请重新填写。' };
    }
    if (organization.status === 429) {
      return { ...base, status: 'rate_limited', message: 'Neon 接口触发限流，请稍后再试。' };
    }
    return { ...base, status: 'error', message: organization.message };
  }

  const listResult = await neonGet<{ projects?: unknown }>(
    `/projects?org_id=${encodeURIComponent(organization.id)}&limit=${MAX_PROJECTS}`,
    input.apiKey,
  );
  if (isFailure(listResult)) {
    if (listResult.status === 401 || listResult.status === 403) {
      return { ...base, status: 'credential_error', message: 'Neon API Key 无效或权限不足，请重新填写。' };
    }
    if (listResult.status === 429) {
      return { ...base, status: 'rate_limited', message: 'Neon 接口触发限流，请稍后再试。' };
    }
    return { ...base, status: 'error', message: listResult.message };
  }

  const listed = Array.isArray(listResult.data.projects) ? listResult.data.projects : [];
  const allIds = listed
    .map((item) => asRecord(item).id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const projectIds = input.projectId ? [input.projectId] : allIds.slice(0, MAX_PROJECTS);
  if (!projectIds.length) {
    return { ...base, status: 'unsupported', message: '该 Neon 组织下没有可读取的项目。' };
  }

  const usages: NeonProjectUsage[] = [];
  let lastError = '';
  for (const projectId of projectIds) {
    const usage = await readProjectUsage(input.apiKey, projectId, input.selfMeasuredStorageBytes);
    if ('error' in usage) lastError = usage.error;
    else usages.push(usage);
  }
  if (!usages.length) {
    return {
      ...base,
      status: 'error',
      message: lastError || 'Neon 项目用量读取失败。',
    };
  }

  const metrics: PlatformMetric[] = [];
  const compute = worstMetric(
    'compute',
    'Compute',
    'CU-hrs',
    NEON_FREE_LIMITS.computeCuHours,
    usages.map((usage) => ({ project: usage.name, used: usage.computeSeconds / 3600 })),
  );
  if (compute) metrics.push(compute);

  const storageReadings = usages
    .filter((usage): usage is NeonProjectUsage & { storageBytes: number } => usage.storageBytes != null)
    .map((usage) => ({ project: usage.name, used: usage.storageBytes / GB }));
  const storage = worstMetric('storage', 'Storage', 'GB', NEON_FREE_LIMITS.storageBytes / GB, storageReadings);
  if (storage) {
    metrics.push({
      ...storage,
      note: storage.note ? `${storage.note} · 含分支逻辑大小` : '含分支逻辑大小',
    });
  }

  const egress = worstMetric(
    'egress',
    'Public network transfer',
    'GB',
    NEON_FREE_LIMITS.transferBytes / GB,
    usages.map((usage) => ({ project: usage.name, used: usage.transferBytes / GB })),
  );
  if (egress) metrics.push(egress);

  if (!metrics.length) {
    return { ...base, status: 'unsupported', message: 'Neon 未返回可识别的用量字段，请到 Neon 控制台核对。' };
  }

  const periodStart = usages.find((usage) => usage.periodStart)?.periodStart ?? null;
  const periodEnd = usages.find((usage) => usage.periodEnd)?.periodEnd ?? null;
  const scopeNote =
    allIds.length > projectIds.length ? `仅检查前 ${projectIds.length} 个项目（共 ${allIds.length} 个）。` : '';

  return {
    ...base,
    status: statusFromMetrics(metrics),
    message: ['数据来自 Neon 项目接口，可能有最多 1 小时延迟。', scopeNote].filter(Boolean).join(' '),
    observedAt: now,
    periodStart,
    periodEnd,
    metrics,
    accountLabel: organization.id,
  };
}
