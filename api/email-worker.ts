// 邮件队列消费端点：Vercel Cron（Pro 每分钟）或外部定时器调用；无鉴权但只发送
// 已存在且未过期的验证码（能力受限），配合队列上限/重试/全局节流，风险可控。
// Hobby 套餐 Cron 每天最多一次，日常投递由 send-code 同步首送 + opportunisticDrain 兜底。
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requestId, sendDatabaseError } from './_apiError.js';
import { loadSmtpConfig } from './emailAuth.js';
import { drainOutbox } from './_emailQueue.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  requestId(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' });
    return;
  }
  try {
    const smtp = await loadSmtpConfig();
    if (!smtp) {
      res.json({ ok: true, sent: 0, failed: 0, remaining: 0, skipped: 'not_configured' });
      return;
    }
    const result = await drainOutbox(smtp, { max: 5, hardTimeoutMs: 8_000, acquireSlot: false });
    res.json({ ok: true, ...result });
  } catch (error) {
    sendDatabaseError(req, res, error, 'write');
  }
}
