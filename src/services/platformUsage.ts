// 平台额度面板的前端服务层。
// 凭据只在提交时经过这里一次，之后接口只会回显尾号提示，不会回传明文。
import { authHeaders } from './auth/session';

export type PlatformStatus =
  'ok' | 'warning' | 'critical' | 'unconfigured' | 'unsupported' | 'credential_error' | 'rate_limited' | 'error';

export type PlatformMetric = {
  key: string;
  label: string;
  used: number;
  limit: number | null;
  unit: string;
  percent: number | null;
  note?: string;
};

export type PlatformProviderSnapshot = {
  provider: 'vercel' | 'neon';
  label: string;
  status: PlatformStatus;
  message: string;
  observedAt: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  metrics: PlatformMetric[];
  consoleUrl: string;
  source: string;
  accountLabel: string | null;
  stale: boolean;
};

export type PlatformConfigFieldSpec = {
  key: string;
  label: string;
  placeholder: string;
  hint: string;
  required: boolean;
  secret: boolean;
};

export type PlatformProviderView = {
  provider: 'vercel' | 'neon';
  enabled: boolean;
  configured: boolean;
  hint: string | null;
  updatedAt: number | null;
  fields: PlatformConfigFieldSpec[];
  consoleUrl: string;
  snapshot: PlatformProviderSnapshot | null;
};

export type PlatformUsagePayload = {
  ok: true;
  environment: { runtime: 'vercel' | 'local'; database: 'neon' | 'postgres' | 'unknown'; local: boolean };
  providers: PlatformProviderView[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  const data = (await response.json().catch(() => null)) as (T & { error?: string; code?: string }) | null;
  if (!response.ok || !data) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }
  return data;
}

export function fetchPlatformUsage(): Promise<PlatformUsagePayload> {
  return request<PlatformUsagePayload>('/api/platform-usage');
}

export function savePlatformConfig(
  provider: 'vercel' | 'neon',
  values: Record<string, string>,
): Promise<PlatformUsagePayload> {
  return request<PlatformUsagePayload>('/api/platform-usage-config', {
    method: 'POST',
    body: JSON.stringify({ provider, values }),
  });
}

export function clearPlatformConfig(provider: 'vercel' | 'neon'): Promise<PlatformUsagePayload> {
  return request<PlatformUsagePayload>('/api/platform-usage-config', {
    method: 'POST',
    body: JSON.stringify({ provider, action: 'clear' }),
  });
}

export function refreshPlatformUsage(provider: 'vercel' | 'neon'): Promise<PlatformUsagePayload> {
  return request<PlatformUsagePayload>('/api/platform-usage-refresh', {
    method: 'POST',
    body: JSON.stringify({ provider }),
  });
}
