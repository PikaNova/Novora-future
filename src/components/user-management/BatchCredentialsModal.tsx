// 批量创建成功后的凭据展示弹窗（仅当前页面可见，可导出 CSV）。
import AdminModalPortal from '../AdminModalPortal';
import type { BatchCredential } from './types';

export type BatchCredentialsModalProps = {
  batchCredentials: BatchCredential[];
  exportBatchCredentials: () => void;
  setBatchCredentials: (value: BatchCredential[] | null) => void;
};

export function BatchCredentialsModal({
  batchCredentials,
  exportBatchCredentials,
  setBatchCredentials,
}: BatchCredentialsModalProps) {
  return (
    <AdminModalPortal className="admin-modal-overlay">
      <div className="admin-modal admin-modal--wide" onClick={(event) => event.stopPropagation()}>
        <h2 className="admin-modal__title">批量账号已创建</h2>
        <p className="admin-modal__body">
          初始密码仅在当前页面显示。请使用受控渠道分发，关闭此窗口后不能再次导出明文密码。
        </p>
        <div className="user-management__batch-credentials">
          {batchCredentials.map((item) => (
            <div key={item.username}>
              <strong>{item.displayName}</strong>
              <code>{item.username}</code>
              <code>{item.password}</code>
              <small>
                {item.gradeName} · {item.className}
              </small>
            </div>
          ))}
        </div>
        <div className="admin-modal__actions">
          <button className="admin-btn admin-btn--primary" onClick={exportBatchCredentials}>
            导出 CSV
          </button>
          <button className="admin-btn" onClick={() => setBatchCredentials(null)}>
            我已妥善保存
          </button>
        </div>
      </div>
    </AdminModalPortal>
  );
}
