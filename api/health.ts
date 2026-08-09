// 公开健康检查：供 uptime 探针 / 部署后自检 / 本地化部署监控使用。
// 只返回健康状态，不含任何业务数据与密钥；DB/Schema 异常时返回 503 以便告警。
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync } from 'node:fs';
import { authSql, ensureAuthTables } from './_auth.js';
import { assertRows, rowShape, isString, isNumberLike } from './_validation.js';
import { requestId, sendDatabaseError } from './_apiError.js';

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

const isTableRow = rowShape<{ table_name: string }>({ table_name: isString });
const isCountRow = rowShape<{ count: number }>({ count: (v): v is number => typeof v === 'number' });

const CORE_TABLES = ['app_auth', 'app_users', 'app_roles', 'email_config', 'email_outbox', 'write_throttle'];

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  requestId(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' }); return; }
  try {
    const started = Date.now();
    await ensureAuthTables();
    await authSql()`SELECT 1`;
    const latencyMs = Date.now() - started;
    const tables = assertRows(
      await authSql()`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY(${CORE_TABLES})`,
      isTableRow,
      'information_schema',
    );
    const present = new Set(tables.map((row) => row.table_name));
    const missingTables = CORE_TABLES.filter((name) => !present.has(name));
    const pendingRows = assertRows(
      await authSql()`SELECT COUNT(*)::int AS count FROM email_outbox WHERE status='pending' AND next_attempt_at <= ${Date.now()}`,
      isCountRow,
      'email_outbox',
    );
    const schemaOk = missingTables.length === 0;
    const backedUp = Number(pendingRows[0]?.count ?? 0) > 20;
    const ok = schemaOk;
    res.status(ok ? 200 : 503).json({
      ok,
      status: ok ? 'ok' : 'degraded',
      version: appVersion(),
      serverTime: new Date().toISOString(),
      latencyMs,
      checks: {
        db: 'ok',
        schema: schemaOk ? 'ok' : 'mismatch',
        mailQueue: backedUp ? 'backed_up' : 'ok',
      },
    });
  } catch (error) {
    sendDatabaseError(req, res, error, 'read');
  }
}
