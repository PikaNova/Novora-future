// 重置目标管理员密码弹窗（生成或手动输入）。状态与提交逻辑由 UserManagementPanel 持有。
import AdminModalPortal from '../AdminModalPortal';
import type { ManagedUser } from '../../services/adminUsers';
import { generateTemporaryPassword } from './helpers';

export type ResetPasswordModalProps = {
  resetTarget: ManagedUser;
  resetError: string;
  resetMode: 'generated' | 'manual';
  resetPassword: string;
  setResetError: (message: string) => void;
  setResetMode: (mode: 'generated' | 'manual') => void;
  setResetPassword: (value: string) => void;
  setResetTarget: (target: ManagedUser | null) => void;
  submitReset: () => Promise<void> | void;
  busy: boolean;
};

export function ResetPasswordModal({
  resetTarget,
  resetError,
  resetMode,
  resetPassword,
  setResetError,
  setResetMode,
  setResetPassword,
  setResetTarget,
  submitReset,
  busy,
}: ResetPasswordModalProps) {
  return (
    <AdminModalPortal className="admin-modal-overlay">
      <div className="admin-modal" onClick={(event) => event.stopPropagation()}>
        <h2 className="admin-modal__title">重置 {resetTarget.displayName} 的密码</h2>
        <p className="admin-modal__body">重置后该用户当前登录立即失效，下次登录必须再次修改用户名和密码。</p>
        <div className="user-management__reset-modes">
          <button
            className={resetMode === 'generated' ? 'is-active' : ''}
            onClick={() => {
              setResetMode('generated');
              setResetPassword(generateTemporaryPassword());
              setResetError('');
            }}
          >
            自动生成临时密码
          </button>
          <button
            className={resetMode === 'manual' ? 'is-active' : ''}
            onClick={() => {
              setResetMode('manual');
              setResetPassword('');
              setResetError('');
            }}
          >
            手动设置
          </button>
        </div>
        {resetError && <div className="admin-error">{resetError}</div>}
        <label className="admin-label">
          临时密码
          <input
            className="admin-input"
            type={resetMode === 'manual' ? 'password' : 'text'}
            value={resetPassword}
            onChange={(event) => {
              setResetPassword(event.target.value);
              setResetError('');
            }}
            placeholder="新密码，至少 8 位"
          />
        </label>
        {resetMode === 'generated' && (
          <button
            className="admin-btn user-management__regenerate"
            onClick={() => setResetPassword(generateTemporaryPassword())}
          >
            重新生成
          </button>
        )}
        <div className="admin-modal__actions">
          <button className="admin-btn admin-btn--primary" disabled={busy} onClick={() => void submitReset()}>
            {busy ? '正在重置…' : '确认重置'}
          </button>
          <button
            className="admin-btn"
            onClick={() => {
              setResetTarget(null);
              setResetPassword('');
              setResetError('');
            }}
          >
            取消
          </button>
        </div>
      </div>
    </AdminModalPortal>
  );
}
