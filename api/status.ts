// 系统状态接口：仅超级管理员可访问，用于查看服务器/数据库/配置/邮件队列等系统级状态。
// 兼容纯本地化部署：服务器信息全部来自 Node 运行时（process/os），不依赖 Vercel 专属能力；
// Vercel 字段（region/runtime）仅在存在时返回。
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { authSql, ensureAuthTables, isAdminRecoveryConfigured, requireActor } from './_auth.js';
import { assertRows, rowShape, isString, isNumberLike, isDatabaseInt8, type DatabaseInt8 } from './_validation.js';
import { requestId, sendDatabaseError } from './_apiError.js';
import { loadSmtpConfig } from './emailAuth.js';

let cachedVersion: string | null = null;
function readVersionFrom(url: URL): string | null {
  try {
    const pkg = JSON.parse(readFileSync(url, 'utf8')) as { version?: string };
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : null;
  } catch {
    return null;
  }
}
function appVersion(): string {
  if (cachedVersion) return cachedVersion;
  cachedVersion =
    readVersionFrom(new URL('../package.json', import.meta.url)) ??
    readVersionFrom(new URL('../../package.json', import.meta.url)) ??
    readVersionFrom(new URL('file://' + process.cwd().replace(/\\/g, '/') + '/package.json')) ??
    'unknown';
  return cachedVersion;
}

const isCountRow = rowShape<{ count: number }>({ count: (v): v is number => typeof v === 'number' });
const isTableRow = rowShape<{ table_name: string }>({ table_name: isString });
const isStatusRow = rowShape<{ status: string; n: number }>({ status: isString, n: (v): v is number => typeof v === 'number' });
const isThrottleRow = rowShape<{ last_sent_at: number | string }>({ last_sent_at: (v): v is number | string => typeof v === 'number' || typeof v === 'string' });
const isErrorRow = rowShape<{ last_error: string }>({ last_error: isString });
const isEventRow = rowShape<{ username: string; action: string; resource_type: string; detail: unknown; created_at: DatabaseInt8 }>({
  username: isString,
  action: isString,
  resource_type: isString,
  detail: (v): v is unknown => true,
  created_at: isDatabaseInt8,
});

const REQUIRED_TABLES = [
  'app_auth', 'app_roles', 'app_users', 'app_user_scopes', 'app_audit_logs',
  'email_config', 'email_verification_codes', 'email_outbox', 'mail_throttle',
  'write_throttle', 'device_instances', 'classisland_plugin_instances',
];

function smtpPresetOf(host: string): 'qq' | '163' | 'custom' {
  const h = host.toLowerCase();
  if (h.includes('qq.com')) return 'qq';
  if (h.includes('163.com')) return '163';
  return 'custom';
}

async function collectDatabase(): Promise<{ reachable: boolean; latencyMs: number | null; schemaOk: boolean; missingTables: string[]; writeThrottleNextAllowedAt: number | null; error?: string }> {
  try {
    const started = Date.now();
    await ensureAuthTables();
    await authSql()`SELECT 1`;
    const latencyMs = Date.now() - started;
    const tables = assertRows(
      await authSql()`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY(${REQUIRED_TABLES})`,
      isTableRow,
      'information_schema',
    );
    const present = new Set(tables.map((row) => row.table_name));
    const missingTables = REQUIRED_TABLES.filter((name) => !present.has(name));
    const throttle = assertRows(
      await authSql()`SELECT next_allowed_at FROM write_throttle WHERE id=1`,
      rowShape<{ next_allowed_at: number | string }>({ next_allowed_at: (v): v is number | string => typeof v === 'number' || typeof v === 'string' }),
      'write_throttle',
    );
    return {
      reachable: true,
      latencyMs,
      schemaOk: missingTables.length === 0,
      missingTables,
      writeThrottleNextAllowedAt: throttle[0] ? Number(throttle[0].next_allowed_at) : null,
    };
  } catch (error) {
    return { reachable: false, latencyMs: null, schemaOk: false, missingTables: [], writeThrottleNextAllowedAt: null, error: String(error instanceof Error ? error.message : error).slice(0, 200) };
  }
}

async function collectInfra(): Promise<{ users: { total: number; active: number; pendingChangePassword: number }; roles: number; devices: { total: number; online: number; revoked: number }; plugins: number }> {
  const fiveMinAgo = Date.now() - 5 * 60_000;
  const [userRows, roleRows, deviceRows, pluginRows] = await Promise.all([
    authSql()`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='active')::int AS active, COUNT(*) FILTER (WHERE must_change_password)::int AS pending FROM app_users`,
    authSql()`SELECT COUNT(*)::int AS count FROM app_roles`,
    authSql()`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE NOT revoked AND last_seen_at >= ${fiveMinAgo})::int AS online, COUNT(*) FILTER (WHERE revoked)::int AS revoked FROM device_instances`,
    authSql()`SELECT COUNT(*)::int AS count FROM classisland_plugin_instances`,
  ]);
  const user = assertRows(userRows, rowShape<{ total: number; active: number; pending: number }>({ total: (v): v is number => typeof v === 'number', active: (v): v is number => typeof v === 'number', pending: (v): v is number => typeof v === 'number' }), 'app_users')[0];
  const roles = Number(assertRows(roleRows, isCountRow, 'app_roles')[0]?.count ?? 0);
  const device = assertRows(deviceRows, rowShape<{ total: number; online: number; revoked: number }>({ total: (v): v is number => typeof v === 'number', online: (v): v is number => typeof v === 'number', revoked: (v): v is number => typeof v === 'number' }), 'device_instances')[0];
  const plugins = Number(assertRows(pluginRows, isCountRow, 'classisland_plugin_instances')[0]?.count ?? 0);
  return {
    users: { total: user?.total ?? 0, active: user?.active ?? 0, pendingChangePassword: user?.pending ?? 0 },
    roles,
    devices: { total: device?.total ?? 0, online: device?.online ?? 0, revoked: device?.revoked ?? 0 },
    plugins,
  };
}

async function collectMailQueue(): Promise<{ pending: number; sending: number; sent: number; failed: number; lastError: string | null; lastSentAt: number | null }> {
  const statusRows = assertRows(
    await authSql()`SELECT status, COUNT(*)::int AS n FROM email_outbox GROUP BY status`,
    isStatusRow,
    'email_outbox',
  );
  const counts: Record<string, number> = {};
  for (const row of statusRows) counts[row.status] = row.n;
  const errorRows = assertRows(
    await authSql()`SELECT last_error FROM email_outbox WHERE status IN ('pending','failed') AND last_error <> '' ORDER BY updated_at DESC LIMIT 1`,
    isErrorRow,
    'email_outbox',
  );
  const throttleRows = assertRows(
    await authSql()`SELECT last_sent_at FROM mail_throttle WHERE id=1`,
    isThrottleRow,
    'mail_throttle',
  );
  return {
    pending: counts.pending ?? 0,
    sending: counts.sending ?? 0,
    sent: counts.sent ?? 0,
    failed: counts.failed ?? 0,
    lastError: errorRows[0]?.last_error ?? null,
    lastSentAt: throttleRows[0] ? Number(throttleRows[0].last_sent_at) : null,
  };
}

async function collectEvents(): Promise<Array<{ username: string; action: string; resourceType: string; detail: unknown; createdAt: number }>> {
  const rows = assertRows(
    await authSql()`SELECT username, action, resource_type, detail, created_at FROM app_audit_logs
      WHERE action NOT LIKE 'major.%' AND action NOT LIKE 'weekly.%' AND action NOT LIKE 'exam.%'
      ORDER BY created_at DESC LIMIT 20`,
    isEventRow,
    'app_audit_logs',
  );
  return rows.map((row) => ({ username: row.username, action: row.action, resourceType: row.resource_type, detail: row.detail, createdAt: Number(row.created_at) }));
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  requestId(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' }); return; }
  try {
    const actor = await requireActor(req, res);
    if (!actor) return;
    if (!actor.permissions.includes('*')) {
      res.status(403).json({ ok: false, code: 'PERMISSION_DENIED', error: '仅超级管理员可查看系统状态' });
      return;
    }
    const [database, infra, mailQueue, events, recoveryConfigured, smtp] = await Promise.all([
      collectDatabase(),
      collectInfra(),
      collectMailQueue(),
      collectEvents(),
      isAdminRecoveryConfigured(),
      loadSmtpConfig(),
    ]);
    const now = Date.now();
    res.json({
      ok: true,
      fetchedAt: now,
      service: {
        version: appVersion(),
        runtime: process.env.VERCEL ? 'vercel' : 'local',
        region: process.env.VERCEL_REGION ?? null,
      },
      server: {
        hostname: hostname(),
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        uptimeSeconds: Math.round(process.uptime()),
        memory: { rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed },
        time: { iso: new Date(now).toISOString(), epochMs: now, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      },
      config: {
        databaseConfigured: Boolean(process.env.DATABASE_URL),
        adminPasswordConfigured: Boolean(process.env.ADMIN_PASSWORD),
        deployHookConfigured: Boolean(process.env.VERCEL_DEPLOY_HOOK_URL),
        recoveryConfigured,
        smtpConfigured: Boolean(smtp),
        smtpPreset: smtp ? smtpPresetOf(smtp.host) : null,
      },
      database,
      infra,
      mailQueue,
      events,
    });
  } catch (error) {
    sendDatabaseError(req, res, error, 'read');
  }
}
