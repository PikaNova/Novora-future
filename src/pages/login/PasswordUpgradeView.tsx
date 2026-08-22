// 初始账户密码升级视图（首次登录强制改密 + 邮箱绑定）。状态与请求逻辑仍由 LoginPage 持有。
import type { FormEvent } from 'react';
import type { EmailBindPolicy } from '../../services/emailAuth';

export type PasswordUpgradeDraft = {
  current: string;
  username: string;
  next: string;
  confirm: string;
  token: string;
};

export type PasswordUpgradeViewProps = {
  passwordUpgrade: PasswordUpgradeDraft;
  setPasswordUpgrade: (updater: (value: PasswordUpgradeDraft | null) => PasswordUpgradeDraft | null) => void;
  error: string;
  setError: (message: string) => void;
  loading: boolean;
  upgradePassword: (event: FormEvent) => Promise<void> | void;
  emailEnabled: boolean | null;
  emailPolicy: EmailBindPolicy;
  bindStatus: 'idle' | 'requested' | 'bound';
  bindEmail: string;
  setBindEmail: (value: string) => void;
  bindCode: string;
  setBindCode: (value: string) => void;
  bindError: string;
  setBindError: (value: string) => void;
  bindLoading: boolean;
  bindSendRemaining: number;
  sendBindCode: () => Promise<void> | void;
  confirmBind: () => Promise<void> | void;
};

export function PasswordUpgradeView({
  passwordUpgrade,
  setPasswordUpgrade,
  error,
  setError,
  loading,
  upgradePassword,
  emailEnabled,
  emailPolicy,
  bindStatus,
  bindEmail,
  setBindEmail,
  bindCode,
  setBindCode,
  bindError,
  setBindError,
  bindLoading,
  bindSendRemaining,
  sendBindCode,
  confirmBind,
}: PasswordUpgradeViewProps) {
  return (
    <form className="login-form" onSubmit={upgradePassword}>
      <p className="login-form__notice">当前使用的是初始账户信息。请设置自己的登录用户名和新密码，保存后重新登录。</p>
      <label className="login-form__label" htmlFor="new-username">
        新登录用户名
      </label>
      <div className={`login-form__field${error ? ' login-form__field--error' : ''}`}>
        <span aria-hidden="true">@</span>
        <input
          id="new-username"
          type="text"
          autoComplete="username"
          value={passwordUpgrade.username}
          onChange={(event) => {
            setPasswordUpgrade((value) => value && { ...value, username: event.target.value });
            setError('');
          }}
          placeholder="3-40 位字母、数字、点、横线或下划线"
        />
      </div>
      <label className="login-form__label" htmlFor="new-password">
        新密码
      </label>
      <div className={`login-form__field${error ? ' login-form__field--error' : ''}`}>
        <span aria-hidden="true">●</span>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={passwordUpgrade.next}
          onChange={(event) => {
            setPasswordUpgrade((value) => value && { ...value, next: event.target.value });
            setError('');
          }}
          placeholder="至少 8 位"
        />
      </div>
      <label className="login-form__label" htmlFor="confirm-password">
        确认新密码
      </label>
      <div className={`login-form__field${error ? ' login-form__field--error' : ''}`}>
        <span aria-hidden="true">●</span>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={passwordUpgrade.confirm}
          onChange={(event) => {
            setPasswordUpgrade((value) => value && { ...value, confirm: event.target.value });
            setError('');
          }}
          placeholder="再次输入新密码"
        />
      </div>
      {emailEnabled === true && emailPolicy !== 'skip' && (
        <div className="login-email-bind">
          <div className="login-email-bind__head">
            <span>绑定邮箱{emailPolicy === 'force' ? '（必填）' : '（可选）'}</span>
            {emailPolicy === 'force' && <strong>当前系统要求初始化时绑定邮箱</strong>}
          </div>
          {bindStatus === 'bound' ? (
            <p className="login-email-bind__done">已绑定 {bindEmail.trim() || '邮箱'}，保存后将可用邮箱登录。</p>
          ) : (
            <>
              <div className="login-form__field">
                <span aria-hidden="true">@</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={bindEmail}
                  onChange={(e) => {
                    setBindEmail(e.target.value);
                    setBindError('');
                  }}
                  placeholder="用于登录和找回的邮箱"
                />
              </div>
              <div className="login-email-bind__row">
                <div className="login-form__field">
                  <span aria-hidden="true">#</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={bindCode}
                    onChange={(e) => {
                      setBindCode(e.target.value);
                      setBindError('');
                    }}
                    placeholder="6 位验证码"
                  />
                </div>
                <button
                  type="button"
                  className="login-email-bind__send"
                  disabled={bindLoading || bindSendRemaining > 0}
                  onClick={() => void sendBindCode()}
                >
                  {bindLoading ? '发送中…' : bindSendRemaining > 0 ? bindSendRemaining + 's' : '发送验证码'}
                </button>
              </div>
              <button
                type="button"
                className="login-email-bind__confirm"
                disabled={bindLoading || !bindEmail.trim() || !bindCode.trim()}
                onClick={() => void confirmBind()}
              >
                {bindLoading ? '正在绑定…' : '绑定邮箱'}
              </button>
              {bindError && <p className="login-email-bind__error">{bindError}</p>}
              {emailPolicy === 'optional' && (
                <p className="login-email-bind__skip">可稍后在“我的账户”中绑定，不影响本次保存。</p>
              )}
            </>
          )}
        </div>
      )}
      {error && <p className="login-form__error">{error}</p>}
      <button
        className="login-form__submit"
        disabled={loading || (emailEnabled === true && emailPolicy === 'force' && bindStatus !== 'bound')}
        type="submit"
      >
        {loading ? '正在保存…' : '保存用户名和新密码'}
      </button>
    </form>
  );
}
