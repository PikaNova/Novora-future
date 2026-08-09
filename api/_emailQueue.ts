// 邮件出站队列：把 SMTP 发送从请求链路剥离，提供重试/退避/全局节流，防止慢 SMTP 打爆 Serverless 实例。
// 主路径：send-code 入队并同步首送（全局节流串行化）；失败进入队列，由 /api/email-worker（Cron，Pro）
// 或 opportunisticDrain（任意请求顺带消费，Hobby 兜底）重试。
import { sendVerificationCode, type SmtpConfig } from '../src/services/emailSender.js';
import { authSql, ensureAuthTables } from './_auth.js';
import {
  assertRows,
  rowShape,
  isString,
  isDatabaseInt8,
  type DatabaseInt8,
} from './_validation.js';

export const OUTBOX_MAX_ATTEMPTS = 3;
const OUTBOX_RETRY_BACKOFF_MS = [60_000, 300_000];
const OUTBOX_BATCH_MAX = 5;
const MAIL_SLOT_MIN_INTERVAL_MS = 500;
const MAIL_SLOT_WAIT_MS = 2_000;
const STALE_SENDING_MS = 120_000;
const ENQUEUE_WINDOW_MS = 5 * 60_000;
const OPPORTUNISTIC_MIN_INTERVAL_MS = 20_000;
const OPPORTUNISTIC_BUDGET_MS = 3_000;
const OPPORTUNISTIC_MAX = 1;

let lastEnqueueAt = 0;
let lastOpportunisticDrainAt = 0;

type OutboxJobRow = {
  id: DatabaseInt8;
  email: string;
  purpose: string;
  code_id: DatabaseInt8 | null;
  attempts: number;
  next_attempt_at: DatabaseInt8;
};
const isOutboxJobRow = rowShape<OutboxJobRow>({
  id: isDatabaseInt8,
  email: isString,
  purpose: isString,
  code_id: (value): value is DatabaseInt8 | null => value == null || isDatabaseInt8(value),
  attempts: (value): value is number => typeof value === 'number',
  next_attempt_at: isDatabaseInt8,
});
const isCodeRow = rowShape<{ code: string; expires_at: DatabaseInt8 }>({ code: isString, expires_at: isDatabaseInt8 });
const isIdRow = rowShape<{ id: DatabaseInt8 }>({ id: isDatabaseInt8 });
const isCountRow = rowShape<{ count: number }>({ count: (value): value is number => typeof value === 'number' });

/** 失败 N 次后下一次重试的延迟；达到上限返回 Infinity（不再重试）。 */
export function outboxRetryDelayMs(attemptsAfterFailure: number): number {
  if (attemptsAfterFailure >= OUTBOX_MAX_ATTEMPTS) return Number.POSITIVE_INFINITY;
  if (attemptsAfterFailure < 1) return OUTBOX_RETRY_BACKOFF_MS[0];
  return OUTBOX_RETRY_BACKOFF_MS[attemptsAfterFailure - 1] ?? OUTBOX_RETRY_BACKOFF_MS[0];
}

/** 入队一条发送任务并返回 outbox id（同时记录“最近入队时间”供顺带消费判断）。 */
export async function enqueueEmailOutbox(email: string, purpose: 'login' | 'bind', codeId: DatabaseInt8): Promise<DatabaseInt8> {
  const now = Date.now();
  const rows = assertRows(
    await authSql()`INSERT INTO email_outbox (email, purpose, code_id, status, attempts, max_attempts, next_attempt_at, last_error, created_at, updated_at)
      VALUES (${email}, ${purpose}, ${codeId}, 'pending', 0, ${OUTBOX_MAX_ATTEMPTS}, ${now}, '', ${now}, ${now})
      RETURNING id`,
    isIdRow,
    'email_outbox',
  );
  lastEnqueueAt = now;
  return rows[0].id;
}

async function recoverStaleSending(now: number): Promise<void> {
  await authSql()`UPDATE email_outbox SET status='pending', next_attempt_at=${now + 60_000}, updated_at=${now}
    WHERE status='sending' AND updated_at < ${now - STALE_SENDING_MS}`;
}

async function claimDueOutbox(max: number, now: number): Promise<OutboxJobRow[]> {
  return assertRows(
    await authSql()`
      WITH picked AS (
        SELECT id FROM email_outbox
        WHERE status='pending' AND next_attempt_at <= ${now}
        ORDER BY id
        LIMIT ${max}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE email_outbox SET status='sending', updated_at=${now}
      FROM picked WHERE email_outbox.id = picked.id
      RETURNING email_outbox.id, email_outbox.email, email_outbox.purpose, email_outbox.code_id, email_outbox.attempts, email_outbox.next_attempt_at`,
    isOutboxJobRow,
    'email_outbox',
  );
}

async function claimJobById(id: DatabaseInt8, now: number): Promise<OutboxJobRow | null> {
  const rows = assertRows(
    await authSql()`UPDATE email_outbox SET status='sending', updated_at=${now}
      WHERE id=${id} AND status='pending'
      RETURNING email_outbox.id, email_outbox.email, email_outbox.purpose, email_outbox.code_id, email_outbox.attempts, email_outbox.next_attempt_at`,
    isOutboxJobRow,
    'email_outbox',
  );
  return rows[0] ?? null;
}

async function fetchCodeRow(codeId: DatabaseInt8): Promise<{ code: string; expires_at: DatabaseInt8 } | null> {
  const rows = assertRows(
    await authSql()`SELECT code, expires_at FROM email_verification_codes WHERE id=${codeId} AND used=FALSE`,
    isCodeRow,
    'email_verification_codes',
  );
  return rows[0] ?? null;
}

async function markJobSent(id: DatabaseInt8, now: number): Promise<void> {
  await authSql()`UPDATE email_outbox SET status='sent', sent_at=${now}, updated_at=${now} WHERE id=${id}`;
}

async function requeueJob(id: DatabaseInt8, attempts: number, nextAt: number, error: string): Promise<void> {
  await authSql()`UPDATE email_outbox SET status='pending', attempts=${attempts}, next_attempt_at=${nextAt}, last_error=${error}, updated_at=${Date.now()} WHERE id=${id}`;
}

async function markJobFailed(id: DatabaseInt8, error: string, now: number): Promise<void> {
  await authSql()`UPDATE email_outbox SET status='failed', last_error=${error}, updated_at=${now} WHERE id=${id}`;
}

async function voidCode(codeId: DatabaseInt8 | null): Promise<void> {
  if (codeId == null) return;
  await authSql()`UPDATE email_verification_codes SET used=TRUE WHERE id=${codeId}`;
}

function sendWithTimeout(smtp: SmtpConfig, input: { to: string; code: string; purpose: 'login' | 'bind' }, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('SMTP 发送超时')); }
    }, timeoutMs);
    sendVerificationCode(smtp, input).then(
      () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } },
      (error: unknown) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } },
    );
  });
}

/** 全局邮件节流槽：同一时刻只允许一个 SMTP 发送（多实例靠单行 UPDATE 原子抢占）。 */
async function acquireMailSlot(waitMs: number): Promise<boolean> {
  await ensureAuthTables();
  const deadline = Date.now() + waitMs;
  while (true) {
    const now = Date.now();
    const rows = assertRows(
      await authSql()`UPDATE mail_throttle SET last_sent_at=${now}
        WHERE id=1 AND last_sent_at <= ${now - MAIL_SLOT_MIN_INTERVAL_MS} RETURNING id`,
      isIdRow,
      'mail_throttle',
    );
    if (rows[0]) return true;
    const remain = deadline - Date.now();
    if (remain <= 0) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(120, remain)));
  }
}

export type OutboxDrainResult = { sent: number; failed: number; remaining: number };

export async function drainOutbox(
  smtp: SmtpConfig,
  options: { max?: number; hardTimeoutMs?: number; deadlineMs?: number; acquireSlot?: boolean; slotWaitMs?: number; jobId?: DatabaseInt8 } = {},
): Promise<OutboxDrainResult> {
  await ensureAuthTables();
  const now = Date.now();
  const deadline = options.deadlineMs ?? now + 120_000;
  const acquireSlot = options.acquireSlot !== false;
  const slotWaitMs = options.slotWaitMs ?? MAIL_SLOT_WAIT_MS;
  await recoverStaleSending(now);

  let claimed: OutboxJobRow[];
  if (options.jobId != null) {
    const job = await claimJobById(options.jobId, now);
    claimed = job ? [job] : [];
  } else {
    claimed = await claimDueOutbox(options.max ?? OUTBOX_BATCH_MAX, now);
  }

  let sent = 0;
  let failed = 0;
  for (let index = 0; index < claimed.length; index += 1) {
    if (Date.now() > deadline) {
      await requeueRemaining(claimed.slice(index), '发送超时预算用尽');
      break;
    }
    const job = claimed[index];
    const codeRow = job.code_id == null ? null : await fetchCodeRow(job.code_id);
    if (!codeRow || Number(codeRow.expires_at) < Date.now()) {
      await markJobFailed(job.id, codeRow ? '验证码已过期' : '验证码记录缺失', Date.now());
      if (job.code_id != null) await voidCode(job.code_id);
      failed += 1;
      continue;
    }
    if (acquireSlot && !(await acquireMailSlot(slotWaitMs))) {
      await requeueJob(job.id, job.attempts, Date.now() + 60_000, '发送通道繁忙，稍后重试');
      continue;
    }
    try {
      await sendWithTimeout(
        smtp,
        { to: job.email, code: codeRow.code, purpose: job.purpose === 'bind' ? 'bind' : 'login' },
        options.hardTimeoutMs ?? 10_000,
      );
      await markJobSent(job.id, Date.now());
      sent += 1;
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error).slice(0, 300);
      const attemptsAfter = job.attempts + 1;
      if (attemptsAfter >= OUTBOX_MAX_ATTEMPTS) {
        await markJobFailed(job.id, message, Date.now());
        if (job.code_id != null) await voidCode(job.code_id);
        failed += 1;
      } else {
        await requeueJob(job.id, attemptsAfter, Date.now() + outboxRetryDelayMs(attemptsAfter), message);
      }
    }
  }

  const countRows = assertRows(
    await authSql()`SELECT COUNT(*)::int AS count FROM email_outbox WHERE status='pending' AND next_attempt_at <= ${Date.now()}`,
    isCountRow,
    'email_outbox',
  );
  return { sent, failed, remaining: Number(countRows[0]?.count ?? 0) };
}

async function requeueRemaining(jobs: OutboxJobRow[], reason: string): Promise<void> {
  const nextAt = Date.now() + 60_000;
  for (const job of jobs) await requeueJob(job.id, job.attempts, nextAt, reason);
}

async function hasDueOutbox(now: number): Promise<boolean> {
  const rows = assertRows(
    await authSql()`SELECT id FROM email_outbox WHERE status='pending' AND next_attempt_at <= ${now} LIMIT 1`,
    isIdRow,
    'email_outbox',
  );
  return rows.length > 0;
}

/**
 * 顺带消费：仅当“最近有新入队”且距上次顺带消费超过 20s 时，才加载配置并最多发送 1 封（3s 预算）。
 * 空闲时零数据库开销，供 Hobby 套餐（Cron 每日一次）兜底投递。
 */
export async function opportunisticDrain(options: { smtpLoader: () => Promise<SmtpConfig | null>; budgetMs?: number; max?: number }): Promise<{ ran: boolean; sent: number }> {
  const now = Date.now();
  if (now - lastEnqueueAt > ENQUEUE_WINDOW_MS) return { ran: false, sent: 0 };
  if (now - lastOpportunisticDrainAt < OPPORTUNISTIC_MIN_INTERVAL_MS) return { ran: false, sent: 0 };
  lastOpportunisticDrainAt = now;
  const budgetMs = options.budgetMs ?? OPPORTUNISTIC_BUDGET_MS;
  try {
    const smtp = await options.smtpLoader();
    if (!smtp) return { ran: true, sent: 0 };
    if (!(await hasDueOutbox(Date.now()))) return { ran: true, sent: 0 };
    const result = await drainOutbox(smtp, {
      max: options.max ?? OPPORTUNISTIC_MAX,
      hardTimeoutMs: Math.max(1_000, budgetMs),
      deadlineMs: Date.now() + budgetMs,
      acquireSlot: true,
      slotWaitMs: 1_500,
    });
    return { ran: true, sent: result.sent };
  } catch {
    return { ran: true, sent: 0 };
  }
}
