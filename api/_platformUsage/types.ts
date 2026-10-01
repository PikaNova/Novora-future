// 平台额度面板的对外契约。前端只依赖这里的形状，不感知具体平台的原始响应。

export type PlatformProviderId = 'vercel' | 'neon';

export const PLATFORM_PROVIDERS: readonly PlatformProviderId[] = ['vercel', 'neon'];

export function isPlatformProviderId(value: unknown): value is PlatformProviderId {
  return value === 'vercel' || value === 'neon';
}

/**
 * 读数状态。本地部署不会出现在返回里；`unconfigured` 之外的失败状态都保留了
 * 「最后一次成功读数」，前端据此显示可能过期的数据。
 */
export type PlatformStatus =
  'ok' | 'warning' | 'critical' | 'unconfigured' | 'unsupported' | 'credential_error' | 'rate_limited' | 'error';

export type PlatformMetric = {
  key: string;
  label: string;
  /** 已用量；limit 为 null 时表示平台未公布上限。 */
  used: number;
  limit: number | null;
  unit: string;
  /** 已用百分比（0-100+）；limit 为 null 时为 null。 */
  percent: number | null;
  note?: string;
};

export type PlatformProviderSnapshot = {
  provider: PlatformProviderId;
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
  /** 数据来自上一次成功读数、本次刷新失败时为 true。 */
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
  provider: PlatformProviderId;
  /** 该平台在当前部署环境下是否启用（本地部署两者都为 false）。 */
  enabled: boolean;
  configured: boolean;
  /** 已保存凭据的尾号提示，例如 `••••ab12`；未配置或非密钥字段为 null。 */
  hint: string | null;
  updatedAt: number | null;
  fields: PlatformConfigFieldSpec[];
  consoleUrl: string;
  snapshot: PlatformProviderSnapshot | null;
};

export type PlatformUsagePayload = {
  ok: true;
  environment: {
    runtime: 'vercel' | 'local';
    database: 'neon' | 'postgres' | 'unknown';
    local: boolean;
  };
  providers: PlatformProviderView[];
};

export function statusTone(status: PlatformStatus): 'ok' | 'warn' | 'err' | 'idle' {
  switch (status) {
    case 'ok':
      return 'ok';
    case 'warning':
      return 'warn';
    case 'critical':
    case 'credential_error':
      return 'err';
    case 'unconfigured':
    case 'unsupported':
    case 'rate_limited':
    case 'error':
      return 'idle';
    default:
      return 'idle';
  }
}

/** 由已用/上限推导读数状态，阈值与系统状态面板的既有口径一致（80% / 95%）。 */
export function statusFromMetrics(metrics: PlatformMetric[]): PlatformStatus {
  let worst: PlatformStatus = 'ok';
  for (const metric of metrics) {
    if (metric.percent == null) continue;
    if (metric.percent >= 100) return 'critical';
    if (metric.percent >= 95) worst = 'critical';
    else if (metric.percent >= 80 && worst === 'ok') worst = 'warning';
  }
  return worst;
}
