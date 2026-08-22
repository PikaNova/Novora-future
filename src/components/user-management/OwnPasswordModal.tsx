// 修改当前账号密码弹窗。状态与提交逻辑由 UserManagementPanel 持有。
import AdminModalPortal from '../AdminModalPortal';
import type { PasswordDraft } from './types';

export type OwnPasswordModalProps = {
  passwordDraft: PasswordDraft;
  setPasswordDraft: React.Dispatch<React.SetStateAction<PasswordDraft>>;
  passwordErrors: Record<string, string>;
  setPasswordErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setPasswordOpen: (open: boolean) => void;
  submitOwnPassword: () => Promise<void> | void;
  busy: boolean;
  forcePasswordChange: boolean;
  mustChangePassword: boolean;
};

export function OwnPasswordModal({
  passwordDraft,
  setPasswordDraft,
  passwordErrors,
  setPasswordErrors,
  setPasswordOpen,
  submitOwnPassword,
  busy,
  forcePasswordChange,
  mustChangePassword,
}: OwnPasswordModalProps) {
  return (
    <AdminModalPortal className="admin-modal-overlay">
      <div className="admin-modal" onClick={(event) => event.stopPropagation()}>
        <h2 className="admin-modal__title">
          {forcePasswordChange || mustChangePassword ? '设置我的账户信息' : '修改我的密码'}
        </h2>
        <p className="admin-modal__body">
          账户信息保存在当前部署的 Neon 数据库。修改成功后所有旧会话会失效，需要使用新用户名和密码重新登录。
        </p>
        <div className="user-management__password-fields">
          {(forcePasswordChange || mustChangePassword) && (
            <label className="admin-label">
              新登录用户名
              <input
                className="admin-input"
                autoComplete="username"
                value={passwordDraft.username}
                onChange={(event) => {
                  setPasswordErrors((value) => ({
                    ...value,
                    username: '',
                  }));
                  setPasswordDraft((value) => ({
                    ...value,
                    username: event.target.value,
                  }));
                }}
                placeholder="3-40 位字母、数字、点、横线或下划线"
              />
              {passwordErrors.username && <small className="admin-field-error">{passwordErrors.username}</small>}
            </label>
          )}
          <label className="admin-label">
            当前密码
            <input
              className="admin-input"
              type="password"
              autoComplete="current-password"
              value={passwordDraft.current}
              onChange={(event) => {
                setPasswordErrors((value) => ({ ...value, current: '' }));
                setPasswordDraft((value) => ({
                  ...value,
                  current: event.target.value,
                }));
              }}
            />
            {passwordErrors.current && <small className="admin-field-error">{passwordErrors.current}</small>}
          </label>
          <label className="admin-label">
            新密码
            <input
              className="admin-input"
              type="password"
              autoComplete="new-password"
              value={passwordDraft.next}
              onChange={(event) => {
                setPasswordErrors((value) => ({ ...value, next: '' }));
                setPasswordDraft((value) => ({
                  ...value,
                  next: event.target.value,
                }));
              }}
              placeholder="至少 8 位"
            />
            {passwordErrors.next && <small className="admin-field-error">{passwordErrors.next}</small>}
          </label>
          <label className="admin-label">
            确认新密码
            <input
              className="admin-input"
              type="password"
              autoComplete="new-password"
              value={passwordDraft.confirm}
              onChange={(event) => {
                setPasswordErrors((value) => ({ ...value, confirm: '' }));
                setPasswordDraft((value) => ({
                  ...value,
                  confirm: event.target.value,
                }));
              }}
            />
            {passwordErrors.confirm && <small className="admin-field-error">{passwordErrors.confirm}</small>}
          </label>
        </div>
        <div className="admin-modal__actions">
          <button className="admin-btn admin-btn--primary" disabled={busy} onClick={() => void submitOwnPassword()}>
            {busy ? '保存中…' : '保存并重新登录'}
          </button>
          {!forcePasswordChange && !mustChangePassword && (
            <button
              className="admin-btn"
              onClick={() => {
                setPasswordOpen(false);
                setPasswordErrors({});
              }}
            >
              取消
            </button>
          )}
        </div>
      </div>
    </AdminModalPortal>
  );
}
