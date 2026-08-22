// 批量添加班级管理员向导弹窗。状态与提交逻辑由 UserManagementPanel 持有，本组件只负责展示与步骤交互。
import AdminModalPortal from '../AdminModalPortal';
import AdminWizardSteps, { AdminWorkflowClose } from '../AdminWizardSteps';
import ClassMultiPicker, { type ClassPickerOption } from '../ClassMultiPicker';
import type { BatchUserDraft } from './types';

export type BatchUserWizardModalProps = {
  batchUserDraft: BatchUserDraft;
  setBatchUserDraft: React.Dispatch<React.SetStateAction<BatchUserDraft | null>>;
  batchUserWizardStep: number;
  setBatchUserWizardStep: React.Dispatch<React.SetStateAction<number>>;
  batchUserError: string;
  setBatchUserError: (message: string) => void;
  busy: boolean;
  classPickerOptions: ClassPickerOption[];
  submitBatchUsers: () => Promise<void> | void;
};

export function BatchUserWizardModal({
  batchUserDraft,
  setBatchUserDraft,
  batchUserWizardStep,
  setBatchUserWizardStep,
  batchUserError,
  setBatchUserError,
  busy,
  classPickerOptions,
  submitBatchUsers,
}: BatchUserWizardModalProps) {
  return (
    <AdminModalPortal className="admin-modal-overlay">
      <div className="admin-modal admin-modal--wide admin-modal--workflow" onClick={(event) => event.stopPropagation()}>
        <h2 className="admin-modal__title admin-workflow-head">批量添加班级管理员</h2>
        <AdminWorkflowClose onClick={() => setBatchUserDraft(null)} />
        <div className="admin-workflow-layout">
          <AdminWizardSteps
            active={batchUserWizardStep}
            steps={[
              { label: '账号规则', hint: '前缀和初始密码' },
              { label: '选择班级', hint: '批量指定目标班级' },
              { label: '确认创建', hint: '生成并导出账号' },
            ]}
            summary={
              <>
                <span>将创建</span>
                <strong>{batchUserDraft.classIds.length} 个账号</strong>
                <span>前缀：{batchUserDraft.prefix || '未填写'}</span>
              </>
            }
          />
          <div className="admin-workflow-content" key={batchUserWizardStep}>
            {batchUserWizardStep === 0 && (
              <div className="admin-workflow-pane">
                <p className="admin-modal__body">
                  每个班级创建一个独立账号，用户名按“前缀 + 年级序号 + 班级序号”生成。
                </p>
                <div className="user-editor__grid">
                  <label className="admin-label">
                    账号前缀
                    <input
                      className="admin-input"
                      value={batchUserDraft.prefix}
                      onChange={(event) => {
                        setBatchUserError('');
                        setBatchUserDraft((value) => value && { ...value, prefix: event.target.value });
                      }}
                      placeholder="class_admin"
                    />
                  </label>
                  <label className="admin-label">
                    统一初始密码
                    <input
                      className="admin-input"
                      type="password"
                      value={batchUserDraft.password}
                      onChange={(event) => {
                        setBatchUserError('');
                        setBatchUserDraft((value) => value && { ...value, password: event.target.value });
                      }}
                      placeholder="至少 8 位，首次登录后必须修改"
                    />
                  </label>
                </div>
              </div>
            )}
            {batchUserWizardStep === 1 && (
              <div className="admin-workflow-pane">
                <div className="admin-label">
                  创建账号的班级
                  <ClassMultiPicker
                    options={classPickerOptions}
                    selectedIds={batchUserDraft.classIds}
                    onChange={(ids) => {
                      setBatchUserError('');
                      setBatchUserDraft((value) => value && { ...value, classIds: ids });
                    }}
                  />
                </div>
                <p className="admin-major-card__hint">
                  示例：class_admin_g1c01。若用户名已存在，已成功创建的账号会保留，并明确提示停止位置。
                </p>
              </div>
            )}
            {batchUserWizardStep === 2 && (
              <div className="admin-workflow-pane">
                <div className="admin-workflow-review">
                  <span>
                    账号前缀<strong>{batchUserDraft.prefix}</strong>
                  </span>
                  <span>
                    目标班级<strong>{batchUserDraft.classIds.length} 个班级</strong>
                  </span>
                  <span>
                    初始密码
                    <strong>{batchUserDraft.password.length >= 8 ? '已设置，创建后必须修改' : '长度不足 8 位'}</strong>
                  </span>
                  <span>
                    结果导出<strong>创建完成后可立即导出 CSV</strong>
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
        {batchUserError && <div className="admin-error">{batchUserError}</div>}
        <div className="admin-modal__actions">
          <button
            className="admin-btn"
            disabled={busy}
            onClick={
              batchUserWizardStep === 0
                ? () => setBatchUserDraft(null)
                : () => setBatchUserWizardStep((value) => value - 1)
            }
          >
            {batchUserWizardStep === 0 ? '取消' : '上一步'}
          </button>
          {batchUserWizardStep < 2 ? (
            <button
              className="admin-btn admin-btn--primary admin-workflow-actions-spacer"
              onClick={() => {
                if (batchUserWizardStep === 0 && !batchUserDraft.prefix.trim()) {
                  setBatchUserError('请填写账号前缀。');
                  return;
                }
                if (batchUserWizardStep === 0 && batchUserDraft.password.length < 8) {
                  setBatchUserError('初始密码至少需要 8 位。');
                  return;
                }
                if (batchUserWizardStep === 1 && !batchUserDraft.classIds.length) {
                  setBatchUserError('请至少选择一个班级。');
                  return;
                }
                setBatchUserError('');
                setBatchUserWizardStep((value) => value + 1);
              }}
            >
              下一步
            </button>
          ) : (
            <button
              className="admin-btn admin-btn--primary admin-workflow-actions-spacer"
              disabled={busy || !batchUserDraft.classIds.length}
              onClick={() => void submitBatchUsers()}
            >
              {busy ? '正在创建…' : `创建 ${batchUserDraft.classIds.length} 个账号`}
            </button>
          )}
        </div>
      </div>
    </AdminModalPortal>
  );
}
