// 找回超级管理员视图：说明页 + 恢复表单。状态与请求逻辑仍由 LoginPage 持有。
import type { FormEvent } from 'react';
import { KeyRound } from 'lucide-react';

export type RecoveryDraft = { username: string; recoveryKey: string; next: string; confirm: string };

export type RecoveryViewProps = {
  recoveryView: 'guide' | 'form' | null;
  recoveryConfigured: boolean | null;
  error: string;
  loading: boolean;
  recoveryDraft: RecoveryDraft;
  setRecoveryDraft: (updater: (value: RecoveryDraft) => RecoveryDraft) => void;
  recoverAccount: (event: FormEvent) => Promise<void> | void;
  setRecoveryView: (view: 'guide' | 'form' | null) => void;
  setError: (message: string) => void;
};

export function RecoveryView({
  recoveryView,
  recoveryConfigured,
  error,
  loading,
  recoveryDraft,
  setRecoveryDraft,
  recoverAccount,
  setRecoveryView,
  setError,
}: RecoveryViewProps) {
  return (
    <div className="login-recovery">
      {recoveryView === 'guide' ? (
        <>
          <div className="login-recovery__icon">
            <KeyRound aria-hidden="true" />
          </div>
          <h2>找回管理员账户</h2>
          <div className="login-recovery__rules">
            <p>
              <strong>班级管理员</strong>
              <span>联系所属年级管理员或超级管理员重置密码。</span>
            </p>
            <p>
              <strong>年级管理员</strong>
              <span>联系超级管理员重置密码。</span>
            </p>
            <p>
              <strong>超级管理员</strong>
              <span>使用首次初始化时保存的恢复密钥自行恢复。</span>
            </p>
          </div>
          {error && <p className="login-form__error">{error}</p>}
          {recoveryConfigured === null ? (
            <p className="login-form__notice">正在检查恢复配置…</p>
          ) : recoveryConfigured ? (
            <button
              className="login-form__submit"
              type="button"
              onClick={() => {
                setRecoveryView('form');
                setError('');
              }}
            >
              恢复超级管理员
            </button>
          ) : (
            <p className="login-form__notice">
              当前项目尚未生成恢复密钥。请由超级管理员完成首次初始化并保存系统自动生成的密钥。
            </p>
          )}
        </>
      ) : (
        <form className="login-form" onSubmit={recoverAccount}>
          <p className="login-form__notice">
            恢复成功后旧登录会话会立即失效；数据库只保存恢复密钥的加盐哈希，不保存明文。
          </p>
          <label className="login-form__label" htmlFor="recovery-username">
            超级管理员用户名
          </label>
          <div className="login-form__field">
            <span aria-hidden="true">@</span>
            <input
              id="recovery-username"
              autoComplete="username"
              value={recoveryDraft.username}
              onChange={(event) => setRecoveryDraft((value) => ({ ...value, username: event.target.value }))}
            />
          </div>
          <label className="login-form__label" htmlFor="recovery-key">
            超级管理员恢复密钥
          </label>
          <div className="login-form__field">
            <span aria-hidden="true">◆</span>
            <input
              id="recovery-key"
              type="password"
              autoComplete="off"
              value={recoveryDraft.recoveryKey}
              onChange={(event) => setRecoveryDraft((value) => ({ ...value, recoveryKey: event.target.value }))}
              placeholder="初始化时保存的 NVR- 密钥"
            />
          </div>
          <label className="login-form__label" htmlFor="recovery-password">
            新密码
          </label>
          <div className="login-form__field">
            <span aria-hidden="true">●</span>
            <input
              id="recovery-password"
              type="password"
              autoComplete="new-password"
              value={recoveryDraft.next}
              onChange={(event) => setRecoveryDraft((value) => ({ ...value, next: event.target.value }))}
              placeholder="至少 8 位"
            />
          </div>
          <label className="login-form__label" htmlFor="recovery-confirm">
            确认新密码
          </label>
          <div className="login-form__field">
            <span aria-hidden="true">●</span>
            <input
              id="recovery-confirm"
              type="password"
              autoComplete="new-password"
              value={recoveryDraft.confirm}
              onChange={(event) => setRecoveryDraft((value) => ({ ...value, confirm: event.target.value }))}
            />
          </div>
          {error && <p className="login-form__error">{error}</p>}
          <button className="login-form__submit" disabled={loading} type="submit">
            {loading ? '正在恢复…' : '确认恢复'}
          </button>
        </form>
      )}
      <button
        className="login-form__link"
        type="button"
        onClick={() => {
          setRecoveryView(recoveryView === 'form' ? 'guide' : null);
          setError('');
        }}
      >
        {recoveryView === 'form' ? '返回找回说明' : '返回登录'}
      </button>
    </div>
  );
}
