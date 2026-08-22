// 修改当前账号用户名弹窗。状态与提交逻辑由 UserManagementPanel 持有。
import AdminModalPortal from '../AdminModalPortal';

export type UsernameDraft = { currentPassword: string; username: string };

export type OwnUsernameModalProps = {
  usernameDraft: UsernameDraft;
  setUsernameDraft: React.Dispatch<React.SetStateAction<UsernameDraft>>;
  usernameError: string;
  setUsernameError: (value: string) => void;
  setUsernameOpen: (open: boolean) => void;
  submitOwnUsername: () => Promise<void> | void;
  busy: boolean;
};

export function OwnUsernameModal({
  usernameDraft,
  setUsernameDraft,
  usernameError,
  setUsernameError,
  setUsernameOpen,
  submitOwnUsername,
  busy,
}: OwnUsernameModalProps) {
  return (
    <AdminModalPortal className="admin-modal-overlay">
      <div className="admin-modal" onClick={(event) => event.stopPropagation()}>
        <h2 className="admin-modal__title">修改我的用户名</h2>
        <p className="admin-modal__body">修改后所有旧会话都会失效，需要使用新用户名重新登录。</p>
        {usernameError && <div className="admin-error">{usernameError}</div>}
        <div className="user-management__password-fields">
          <label className="admin-label">
            新登录用户名
            <input
              className="admin-input"
              autoComplete="username"
              value={usernameDraft.username}
              onChange={(event) => {
                setUsernameError('');
                setUsernameDraft((value) => ({
                  ...value,
                  username: event.target.value,
                }));
              }}
            />
          </label>
          <label className="admin-label">
            验证当前身份
            <input
              className="admin-input"
              type="password"
              autoComplete="current-password"
              value={usernameDraft.currentPassword}
              onChange={(event) => {
                setUsernameError('');
                setUsernameDraft((value) => ({
                  ...value,
                  currentPassword: event.target.value,
                }));
              }}
              placeholder="请输入当前登录密码"
            />
            <small className="admin-field-hint">仅用于验证操作者身份，不会修改当前密码。</small>
          </label>
        </div>
        <div className="admin-modal__actions">
          <button className="admin-btn admin-btn--primary" disabled={busy} onClick={() => void submitOwnUsername()}>
            {busy ? '验证中…' : '验证并修改用户名'}
          </button>
          <button
            className="admin-btn"
            onClick={() => {
              setUsernameOpen(false);
              setUsernameError('');
            }}
          >
            取消
          </button>
        </div>
      </div>
    </AdminModalPortal>
  );
}
