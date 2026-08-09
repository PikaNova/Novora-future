import React, { useEffect, useState } from 'react';
import InlineSelect from './InlineSelect';
import { Switch } from './settings/Switch';
import { confirmDialog } from '../services/appDialog';
import {
  clearEmailConfig,
  fetchEmailConfigFull,
  saveEmailConfig,
  testEmailConfig,
  type EmailBindPolicy,
  type EmailConfigInput,
} from '../services/emailAuth';

const PRESETS: Array<{ value: 'qq' | '163' | 'custom'; label: string }> = [
  { value: 'qq', label: 'QQ 邮箱' },
  { value: '163', label: '163 邮箱' },
  { value: 'custom', label: '自定义（学校内部邮件系统等）' },
];

const POLICY_OPTIONS: Array<{ value: EmailBindPolicy; label: string; hint: string }> = [
  { value: 'optional', label: '可选（推荐）', hint: '新用户初始化时尝试绑定邮箱，可跳过，稍后在“我的账户”中补绑。' },
  { value: 'force', label: '强制', hint: '新用户初始化时必须先绑定邮箱，否则不能保存用户名和新密码。' },
  { value: 'skip', label: '跳过', hint: '初始化流程完全不展示绑定邮箱，由用户之后自行绑定。' },
];

function detectPreset(host: string): 'qq' | '163' | 'custom' {
  const h = host.toLowerCase();
  if (h.includes('qq.com')) return 'qq';
  if (h.includes('163.com')) return '163';
  return 'custom';
}

export default function EmailServicePanel({
  canEditSettings,
  showPolicy = false,
  canEditPolicy = false,
  onSaved,
}: {
  canEditSettings: boolean;
  showPolicy?: boolean;
  canEditPolicy?: boolean;
  onSaved?: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [preset, setPreset] = useState<'qq' | '163' | 'custom'>('custom');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('465');
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [smtpRequireTls, setSmtpRequireTls] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [smtpFromName, setSmtpFromName] = useState('');
  const [adminEmails, setAdminEmails] = useState('');
  const [initBindPolicy, setInitBindPolicy] = useState<EmailBindPolicy>('optional');
  const [testEmail, setTestEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchEmailConfigFull()
      .then((config) => {
        if (!alive) return;
        setEnabled(config.enabled);
        setSmtpHost(config.smtpHost);
        setSmtpPort(String(config.smtpPort || 465));
        setSmtpSecure(config.smtpSecure);
        setSmtpRequireTls(config.smtpRequireTls);
        setSmtpUser(config.smtpUser);
        setSmtpFrom(config.smtpFrom);
        setSmtpFromName(config.smtpFromName);
        setAdminEmails(config.adminEmails);
        setInitBindPolicy(config.initBindPolicy);
        setPreset(detectPreset(config.smtpHost));
        setLoaded(true);
      })
      .catch(() => {
        if (alive) {
          setLoaded(true);
          setErr('无法读取邮件服务配置，请稍后重试。');
        }
      });
    return () => { alive = false; };
  }, []);

  const applyPreset = (value: string) => {
    const id = value as 'qq' | '163' | 'custom';
    setPreset(id);
    if (id === 'qq') {
      setSmtpHost('smtp.qq.com'); setSmtpPort('465'); setSmtpSecure(true); setSmtpRequireTls(false);
    } else if (id === '163') {
      setSmtpHost('smtp.163.com'); setSmtpPort('465'); setSmtpSecure(true); setSmtpRequireTls(false);
    }
    setErr(''); setMsg('');
  };

  const input = (): EmailConfigInput => ({
    smtpHost: smtpHost.trim(),
    smtpPort: Number(smtpPort) || 465,
    smtpSecure,
    smtpRequireTls,
    smtpUser: smtpUser.trim(),
    smtpPass,
    smtpFrom: smtpFrom.trim(),
    smtpFromName: smtpFromName.trim(),
    adminEmails: adminEmails.trim(),
    initBindPolicy,
  });

  const save = async () => {
    if (!smtpHost.trim() || !smtpFrom.trim()) { setErr('请填写 SMTP 主机与发件邮箱'); setMsg(''); return; }
    setSaving(true); setErr(''); setMsg('');
    try {
      await saveEmailConfig(input());
      setEnabled(true); setMsg('邮件服务已保存并启用'); onSaved?.();
    } catch (cause) { setErr(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setSaving(false); }
  };

  const test = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail.trim())) { setErr('请输入有效的测试邮箱'); setMsg(''); return; }
    setTesting(true); setErr(''); setMsg('');
    try {
      await testEmailConfig({ ...input(), testEmail: testEmail.trim() });
      setMsg('测试邮件已发送，请查收');
    } catch (cause) { setErr(cause instanceof Error ? cause.message : '测试发送失败'); }
    finally { setTesting(false); }
  };

  const clear = async () => {
    const ok = await confirmDialog({ title: '停用邮件服务', message: '确定清空邮件服务配置并停用邮箱登录与绑定吗？', tone: 'danger', confirmLabel: '停用并清空' });
    if (!ok) return;
    setSaving(true); setErr(''); setMsg('');
    try {
      await clearEmailConfig();
      setEnabled(false);
      setSmtpHost(''); setSmtpPort('465'); setSmtpUser(''); setSmtpPass(''); setSmtpFrom(''); setSmtpFromName(''); setAdminEmails('');
      setMsg('邮件服务已停用'); onSaved?.();
    } catch (cause) { setErr(cause instanceof Error ? cause.message : '停用失败'); }
    finally { setSaving(false); }
  };

  if (!loaded) return <p className="set-note">正在读取邮件服务配置…</p>;

  return (
    <div className="set-fieldset">
      {enabled && <div className="set-status__list"><li><span>服务状态</span><b>已启用</b></li></div>}
      <div className="set-row">
        <label className="set-label">服务预设</label>
        <InlineSelect className="set-input" disabled={!canEditSettings} value={preset} onChange={applyPreset} options={PRESETS} />
      </div>
      <div className="set-row">
        <label className="set-label">SMTP 主机</label>
        <input className="set-input" disabled={!canEditSettings} value={smtpHost} onChange={(e) => { setSmtpHost(e.target.value); setErr(''); }} placeholder="如 smtp.qq.com" />
      </div>
      <div className="set-row">
        <label className="set-label">端口</label>
        <input className="set-input" type="number" disabled={!canEditSettings} value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="465" />
      </div>
      <div className="set-row">
        <label className="set-label">SSL 加密</label>
        <Switch checked={smtpSecure} disabled={!canEditSettings} onChange={setSmtpSecure} />
      </div>
      <div className="set-row">
        <label className="set-label">强制 TLS（STARTTLS）</label>
        <Switch checked={smtpRequireTls} disabled={!canEditSettings} onChange={setSmtpRequireTls} />
      </div>
      <div className="set-row">
        <label className="set-label">SMTP 账号</label>
        <input className="set-input" disabled={!canEditSettings} value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="发件邮箱账号（QQ/163 填邮箱）" />
      </div>
      <div className="set-row">
        <label className="set-label">授权码 / 密码</label>
        <input className="set-input" type="password" autoComplete="new-password" disabled={!canEditSettings} value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} placeholder="留空则保留已保存的授权码" />
      </div>
      <div className="set-row">
        <label className="set-label">发件邮箱</label>
        <input className="set-input" disabled={!canEditSettings} value={smtpFrom} onChange={(e) => { setSmtpFrom(e.target.value); setErr(''); }} placeholder="如 noreply@school.edu.cn" />
      </div>
      <div className="set-row">
        <label className="set-label">发件人名称</label>
        <input className="set-input" disabled={!canEditSettings} value={smtpFromName} onChange={(e) => setSmtpFromName(e.target.value)} placeholder="默认：Novora考试系统" />
      </div>
      <div className="set-row">
        <label className="set-label">邮箱白名单</label>
        <input className="set-input" disabled={!canEditSettings} value={adminEmails} onChange={(e) => setAdminEmails(e.target.value)} placeholder="留空则不限（以已绑定邮箱为准）；多个用逗号分隔" />
      </div>
      <div className="set-row">
        <label className="set-label">测试发送</label>
        <div className="set-row__inline">
          <input className="set-input" disabled={!canEditSettings} value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="接收测试邮件的邮箱" />
          <button className="set-btn" disabled={!canEditSettings || testing} onClick={() => void test()}>{testing ? '发送中…' : '发送测试邮件'}</button>
        </div>
      </div>
      {showPolicy && (
        <div className="set-fieldset__policy">
          <div className="set-row">
            <label className="set-label">初始化绑定邮箱策略</label>
            {!canEditPolicy && <span className="set-note">仅超级管理员可修改</span>}
          </div>
          <div className="set-policy-options">
            {POLICY_OPTIONS.map((option) => (
              <label key={option.value} className={"set-policy-option" + (initBindPolicy === option.value ? " is-active" : "")}>
                <input type="radio" name="init-bind-policy" checked={initBindPolicy === option.value} disabled={!canEditPolicy} onChange={() => { setInitBindPolicy(option.value); setErr(''); }} />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.hint}</small>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="set-actions">
        <button className="set-btn set-btn--primary" disabled={!canEditSettings || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存并启用'}</button>
        {enabled && canEditSettings && <button className="set-btn set-btn--danger" disabled={saving} onClick={() => void clear()}>停用并清空</button>}
      </div>
      {msg && <p className="set-note set-note--success">{msg}</p>}
      {err && <p className="set-note set-note--error">{err}</p>}
    </div>
  );
}
