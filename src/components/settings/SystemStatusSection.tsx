import React, { useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { fetchSystemStatus, type SystemStatusPayload } from '../../services/systemStatus';
import { APP_VERSION } from '../../services/telemetry';

function formatUptime(seconds: number): string {
  const s = Math.max(0, seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return d + ' 天 ' + h + ' 小时';
  if (h > 0) return h + ' 小时 ' + m + ' 分';
  return m + ' 分钟';
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : mb.toFixed(1) + ' MB';
}

function formatPercent(value: number | null): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(1) + '%';
}

function formatClock(epochMs: number): string {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return '—';
  const date = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}

function latencyTone(ms: number | null): string {
  if (ms == null) return 'is-err';
  if (ms <= 300) return 'is-ok';
  if (ms <= 1000) return 'is-warn';
  return 'is-err';
}

function usageTone(value: number | null, warn = 80, err = 92): 'ok' | 'warn' | 'err' | 'idle' {
  if (value == null || !Number.isFinite(value)) return 'idle';
  if (value >= err) return 'err';
  if (value >= warn) return 'warn';
  return 'ok';
}

function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'err' | 'idle' }) {
  return <i className={'system-status__dot is-' + tone} aria-hidden="true" />;
}

export default function SystemStatusSection() {
  const [data, setData] = useState<SystemStatusPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const next = await fetchSystemStatus();
      setData(next);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '系统状态读取失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && !data) {
    return (
      <section className="set-card">
        <h2 className="set-card__title"><Activity size={18} /> 系统状态</h2>
        <p className="set-card__lead">正在读取系统状态…</p>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="set-card">
        <h2 className="set-card__title"><Activity size={18} /> 系统状态</h2>
        <p className="set-note set-note--warn">{error || '系统状态不可用'}</p>
      </section>
    );
  }

  const dbOk = data.database.reachable && data.database.schemaOk;
  const queueWarn = data.mailQueue.failed > 0 || data.mailQueue.pending > 20;
  const dbTone: 'ok' | 'err' | 'warn' = !data.database.reachable ? 'err' : !data.database.schemaOk ? 'warn' : 'ok';
  const events = data.events.slice(0, 10);
  const memUsage =
    data.server.memory.total > 0
      ? (1 - data.server.memory.free / data.server.memory.total) * 100
      : null;
  const isWindows = data.server.platform === 'win32';
  const loadText =
    isWindows && data.server.cpu.load1 === 0
      ? '—'
      : data.server.cpu.load1.toFixed(2) + ' / ' + data.server.cpu.load5.toFixed(2) + ' / ' + data.server.cpu.load15.toFixed(2);
  const largestTables = data.database.largestTables.length
    ? data.database.largestTables.map((item) => item.name + ' ' + formatBytes(item.sizeBytes)).join('、')
    : '—';
  const reqStats = data.requestStats;
  const failedRate =
    reqStats && reqStats.total > 0 ? (reqStats.failed / reqStats.total) * 100 : null;

  return (
    <section className="set-card system-status">
      <div className="set-card__head">
        <h2 className="set-card__title"><Activity size={18} /> 系统状态</h2>
        <button className="set-btn" disabled={loading} onClick={() => void load()}>
          <RefreshCw size={15} aria-hidden="true" /> {loading ? '刷新中…' : '刷新'}
        </button>
      </div>
      <p className="set-card__lead">
        仅超级管理员可见 · 每 30 秒自动刷新。数据全部来自当前部署实例，兼容本地化部署与 Vercel。
      </p>

      <div className="system-status__summary">
        <div className="system-status__summary-item">
          <StatusDot tone={dbTone} />
          <span>数据库</span>
          <b>{data.database.reachable ? (data.database.latencyMs != null ? data.database.latencyMs + ' ms' : '正常') : '不可达'}</b>
        </div>
        <div className="system-status__summary-item">
          <StatusDot tone={data.config.smtpConfigured ? 'ok' : 'idle'} />
          <span>邮件服务</span>
          <b>{data.config.smtpConfigured ? (data.config.smtpPreset === 'qq' ? 'QQ' : data.config.smtpPreset === '163' ? '163' : '自定义') : '未配置'}</b>
        </div>
        <div className="system-status__summary-item">
          <StatusDot tone={queueWarn ? 'warn' : 'ok'} />
          <span>邮件队列</span>
          <b>待发 {data.mailQueue.pending}</b>
        </div>
        <div className="system-status__summary-item">
          <StatusDot tone={usageTone(memUsage)} />
          <span>内存</span>
          <b>{formatPercent(memUsage)}</b>
        </div>
        <div className="system-status__summary-item">
          <StatusDot tone={usageTone(data.server.cpu.usagePercent)} />
          <span>CPU</span>
          <b>{formatPercent(data.server.cpu.usagePercent)}</b>
        </div>
        <div className="system-status__summary-item">
          <StatusDot tone="ok" />
          <span>运行模式</span>
          <b>{data.service.runtime === 'vercel' ? 'Vercel' : '本地部署'}</b>
        </div>
      </div>

      <div className="system-status__grid">
        <section className="system-status__section">
          <h3>服务器</h3>
          <ul className="set-status__list">
            <li><span>主机名</span><b>{data.server.hostname}</b></li>
            <li><span>Node 版本</span><b>{data.server.node}</b></li>
            <li><span>平台 / 架构</span><b>{data.server.platform} / {data.server.arch}</b></li>
            <li><span>进程</span><b>PID {data.server.pid}</b></li>
            <li><span>启动时间</span><b>{formatClock(data.server.startedAt)}</b></li>
            <li><span>运行时长</span><b>{formatUptime(data.server.uptimeSeconds)}</b></li>
            <li><span>总内存</span><b>{formatBytes(data.server.memory.total)}</b></li>
            <li><span>可用内存</span><b>{formatBytes(data.server.memory.free)}</b></li>
            <li><span>内存使用率</span><b>{formatPercent(memUsage)}</b></li>
            <li><span>内存 RSS</span><b>{formatBytes(data.server.memory.rss)}</b></li>
            <li><span>堆使用</span><b>{formatBytes(data.server.memory.heapUsed)}</b></li>
            <li><span>CPU 型号</span><b>{data.server.cpu.model || '—'}</b></li>
            <li><span>CPU 核心数</span><b>{data.server.cpu.cores}</b></li>
            <li><span>CPU 使用率</span><b>{formatPercent(data.server.cpu.usagePercent)}</b></li>
            <li><span>负载（1/5/15 分钟）</span><b>{loadText}</b></li>
            <li><span>服务器时间</span><b>{formatClock(data.server.time.epochMs)}</b></li>
            <li><span>时区</span><b>{data.server.time.timezone}</b></li>
          </ul>
        </section>

        <section className="system-status__section">
          <h3>配置就绪</h3>
          <ul className="set-status__list">
            <li><span>数据库连接</span><b>{data.config.databaseConfigured ? '已配置' : '未配置'}</b></li>
            <li><span>初始管理员密码</span><b>{data.config.adminPasswordConfigured ? '已配置' : '未配置'}</b></li>
            <li><span>部署钩子</span><b>{data.config.deployHookConfigured ? '已配置' : '未配置'}</b></li>
            <li><span>恢复密钥</span><b>{data.config.recoveryConfigured ? '已生成' : '未生成'}</b></li>
            <li><span>邮件服务</span><b>{data.config.smtpConfigured ? '已启用' : '未配置'}</b></li>
            <li><span>应用版本</span><b>v{data.service.version === 'unknown' ? APP_VERSION : data.service.version}</b></li>
            <li><span>区域</span><b>{data.service.region ?? '—'}</b></li>
          </ul>
        </section>

        <section className="system-status__section">
          <h3>数据库</h3>
          <ul className="set-status__list">
            <li><span>连通性</span><b>{data.database.reachable ? '正常' : '异常'}</b></li>
            <li><span>往返延迟</span><b className={'system-status__latency ' + latencyTone(data.database.latencyMs)}>{data.database.latencyMs != null ? data.database.latencyMs + ' ms' : '—'}</b></li>
            <li><span>PostgreSQL 版本</span><b>{data.database.version || '—'}</b></li>
            <li><span>数据库大小</span><b>{formatBytes(data.database.sizeBytes ?? -1)}</b></li>
            <li><span>表数量</span><b>{data.database.tables ?? '—'}</b></li>
            <li><span>索引数量</span><b>{data.database.indexes ?? '—'}</b></li>
            <li><span>连接（活跃/上限）</span><b>{data.database.activeConnections != null ? data.database.activeConnections + ' / ' + (data.database.maxConnections ?? '—') : '—'}</b></li>
            <li><span>缓存命中率</span><b>{formatPercent(data.database.cacheHitRate)}</b></li>
            <li><span>事务提交 / 回滚</span><b>{data.database.xactCommit != null ? data.database.xactCommit.toLocaleString() + ' / ' + (data.database.xactRollback ?? 0).toLocaleString() : '—'}</b></li>
            <li><span>最大表</span><b>{largestTables}</b></li>
            <li><span>Schema</span><b>{data.database.schemaOk ? '完整' : '不匹配'}</b></li>
            <li><span>缺失表</span><b>{data.database.missingTables.length ? data.database.missingTables.join(', ') : '无'}</b></li>
            <li><span>写入闸门</span><b>{data.database.writeThrottleNextAllowedAt ? formatClock(data.database.writeThrottleNextAllowedAt) : '空闲'}</b></li>
          </ul>
        </section>

        <section className="system-status__section">
          <h3>系统数据</h3>
          <ul className="set-status__list">
            <li><span>账号总数</span><b>{data.infra.users.total}</b></li>
            <li><span>启用账号</span><b>{data.infra.users.active}</b></li>
            <li><span>待改初始密码</span><b>{data.infra.users.pendingChangePassword}</b></li>
            <li><span>角色数</span><b>{data.infra.roles}</b></li>
            <li><span>设备（在线/总/吊销）</span><b>{data.infra.devices.online} / {data.infra.devices.total} / {data.infra.devices.revoked}</b></li>
            <li><span>插件实例</span><b>{data.infra.plugins}</b></li>
          </ul>
        </section>

        <section className="system-status__section">
          <h3>邮件队列</h3>
          <ul className="set-status__list">
            <li><span>待发</span><b>{data.mailQueue.pending}</b></li>
            <li><span>发送中</span><b>{data.mailQueue.sending}</b></li>
            <li><span>已发送</span><b>{data.mailQueue.sent}</b></li>
            <li><span>失败</span><b>{data.mailQueue.failed}</b></li>
            <li><span>最近发送</span><b>{data.mailQueue.lastSentAt ? formatClock(data.mailQueue.lastSentAt) : '—'}</b></li>
            <li><span>最近错误</span><b>{data.mailQueue.lastError || '无'}</b></li>
          </ul>
        </section>

        {reqStats ? (
          <section className="system-status__section">
            <h3>本地请求统计</h3>
            <ul className="set-status__list">
              <li><span>统计窗口</span><b>最近 5 分钟</b></li>
              <li><span>请求总数</span><b>{reqStats.total}</b></li>
              <li><span>失败数</span><b>{reqStats.failed}</b></li>
              <li><span>失败率</span><b>{formatPercent(failedRate)}</b></li>
            </ul>
          </section>
        ) : null}

        <section className="system-status__section system-status__section--wide">
          <h3>最近系统事件</h3>
          {events.length ? (
            <ul className="system-status__events">
              {events.map((event, index) => (
                <li key={index}>
                  <span className="system-status__event-time">{formatClock(event.createdAt)}</span>
                  <code>{event.action}</code>
                  <span className="system-status__event-user">{event.username || '系统'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="set-note">暂无系统事件</p>
          )}
        </section>
      </div>

      {error && <p className="set-note set-note--warn">{error}</p>}
    </section>
  );
}
