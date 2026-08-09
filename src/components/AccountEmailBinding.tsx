import React, { useEffect, useState } from 'react';
import { bindEmailConfirm, bindEmailRequest, fetchEmailConfig, unbindEmail } from '../services/emailAuth';

export default function AccountEmailBinding() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [sendUntil, setSendUntil] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchEmailConfig()
      .then((cfg) => { if (alive) { setEnabled(cfg.enabled); setEmail(cfg.email); } })
      .catch(() => { if (alive) setEnabled(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!sendUntil) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((sendUntil - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [sendUntil]);

  const send = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.trim())) { setErr('请输入有效的邮箱地址'); setMsg(''); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      await bindEmailRequest(draft.trim());
      setSendUntil(Date.now() + 60_000);
      setMsg('验证码已发送到该邮箱，5 分钟内有效');
    } catch (cause) { setErr(cause instanceof Error ? cause.message : '验证码发送失败'); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!draft.trim() || !code.trim()) { setErr('请输入邮箱和验证码'); setMsg(''); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      await bindEmailConfirm(draft.trim(), code.trim());
      setEmail(draft.trim()); setDraft(''); setCode(''); setMsg('邮箱绑定成功，之后可用邮箱验证码登录');
    } catch (cause) { setErr(cause instanceof Error ? cause.message : '邮箱绑定失败'); }
    finally { setBusy(false); }
  };

  const unbind = async () => {
    if (!window.confirm('确定解绑当前邮箱吗？解绑后将无法使用邮箱验证码登录。')) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      await unbindEmail();
      setEmail(null); setMsg('邮箱已解绑');
    } catch (cause) { setErr(cause instanceof Error ? cause.message : '解绑失败'); }
    finally { setBusy(false); }
  };

  if (enabled !== true) return null;

  return (
    <section className="account-email-binding">
      <div className="account-email-binding__head">
        <strong>邮箱绑定</strong>
        {email
          ? <span className="account-email-binding__bound">已绑定：{email}</span>
          : <span>未绑定。绑定后可使用邮箱验证码登录。</span>}
      </div>
      {email ? (
        <button className="admin-btn admin-btn--danger" disabled={busy} onClick={() => void unbind()}>
          {busy ? '处理中…' : '解绑邮箱'}
        </button>
      ) : (
        <div className="account-email-binding__form">
          <input className="admin-input" type="email" value={draft} onChange={(e) => { setDraft(e.target.value); setErr(''); }} placeholder="输入要绑定的邮箱" />
          <div className="account-email-binding__row">
            <input className="admin-input" value={code} maxLength={6} onChange={(e) => { setCode(e.target.value); setErr(''); }} placeholder="6 位验证码" />
            <button className="admin-btn" disabled={busy || remaining > 0} onClick={() => void send()}>
              {busy ? '发送中…' : remaining > 0 ? remaining + 's' : '发送验证码'}
            </button>
          </div>
          <button className="admin-btn admin-btn--primary" disabled={busy || !draft.trim() || !code.trim()} onClick={() => void confirm()}>
            {busy ? '处理中…' : '绑定邮箱'}
          </button>
        </div>
      )}
      {msg && <p className="account-email-binding__msg">{msg}</p>}
      {err && <p className="account-email-binding__err">{err}</p>}
    </section>
  );
}
