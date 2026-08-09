// 系统状态与健康检查前端服务。
export type SystemStatusPayload = {
  ok: boolean;
  fetchedAt: number;
  service: { version: string; runtime: 'vercel' | 'local'; region: string | null };
  server: {
    hostname: string; node: string; platform: string; arch: string; pid: number; uptimeSeconds: number; startedAt: number;
    memory: { rss: number; heapUsed: number; total: number; free: number };
    cpu: { model: string | null; cores: number; usagePercent: number | null; load1: number; load5: number; load15: number };
    time: { iso: string; epochMs: number; timezone: string };
  };
  config: {
    databaseConfigured: boolean; adminPasswordConfigured: boolean; deployHookConfigured: boolean;
    recoveryConfigured: boolean; smtpConfigured: boolean; smtpPreset: string | null;
  };
  database: {
    reachable: boolean; latencyMs: number | null; schemaOk: boolean; missingTables: string[]; writeThrottleNextAllowedAt: number | null;
    version: string | null; sizeBytes: number | null; tables: number | null; indexes: number | null;
    activeConnections: number | null; maxConnections: number | null;
    cacheHitRate: number | null; xactCommit: number | null; xactRollback: number | null;
    largestTables: Array<{ name: string; sizeBytes: number }>;
    error?: string;
  };
  infra: {
    users: { total: number; active: number; pendingChangePassword: number };
    roles: number;
    devices: { total: number; online: number; revoked: number };
    plugins: number;
  };
  mailQueue: { pending: number; sending: number; sent: number; failed: number; lastError: string | null; lastSentAt: number | null };
  events: Array<{ username: string; action: string; resourceType: string; detail: unknown; createdAt: number }>;
  requestStats?: { windowStart: number; total: number; failed: number } | null;
};

function authToken(): string {
  try { return localStorage.getItem('admin_auth_token') || ''; } catch { return ''; }
}

async function request<T>(path: string): Promise<T> {
  const token = authToken();
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || 'HTTP ' + response.status);
  }
  return data as T;
}

export function fetchSystemStatus(): Promise<SystemStatusPayload> {
  return request<SystemStatusPayload>('/api/status');
}

export type HealthPayload = {
  ok: boolean;
  status: string;
  version: string;
  serverTime: string;
  latencyMs: number;
  checks: { db: string; schema: string; mailQueue: string };
};

export async function fetchHealth(): Promise<HealthPayload> {
  const response = await fetch('/api/health', { cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!data) throw new Error('健康检查无响应');
  return data as HealthPayload;
}
