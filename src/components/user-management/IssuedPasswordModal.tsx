// 重置后签发的一次性明文密码展示弹窗（可复制）。
import AdminModalPortal from '../AdminModalPortal';

export type IssuedPasswordModalProps = {
  issuedPassword: { displayName: string; password: string };
  copyStatus: string;
  setCopyStatus: (value: string) => void;
  setIssuedPassword: (value: { displayName: string; password: string } | null) => void;
};

export function IssuedPasswordModal({
  issuedPassword,
  copyStatus,
  setCopyStatus,
  setIssuedPassword,
}: IssuedPasswordModalProps) {
  return (
    <AdminModalPortal className="admin-modal-overlay">
      <div className="admin-modal" onClick={(event) => event.stopPropagation()}>
        <h2 className="admin-modal__title">临时密码已创建</h2>
        <p className="admin-modal__body">
          请立即交给 {issuedPassword.displayName}
          。关闭后系统不会再次显示这段密码。
        </p>
        <div className="user-management__issued-password">
          <code>{issuedPassword.password}</code>
          <button
            className="admin-btn admin-btn--primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(issuedPassword.password);
                setCopyStatus('已复制');
              } catch {
                setCopyStatus('复制失败，请手动复制');
              }
            }}
          >
            复制
          </button>
        </div>
        {copyStatus && (
          <p className="admin-field-hint" aria-live="polite">
            {copyStatus}
          </p>
        )}
        <div className="admin-modal__actions">
          <button
            className="admin-btn"
            onClick={() => {
              setIssuedPassword(null);
              setCopyStatus('');
            }}
          >
            我已妥善保存
          </button>
        </div>
      </div>
    </AdminModalPortal>
  );
}
