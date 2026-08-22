// 大型考试新建/重命名向导弹窗（含 AI 导入引导）。状态与提交逻辑由 AdminPage 持有。
import type { HTMLAttributes } from 'react';
import AdminModalPortal from '../AdminModalPortal';
import AdminWizardSteps, { AdminWorkflowClose } from '../AdminWizardSteps';
import HelpTip from '../HelpTip';
import InlineSelect from '../InlineSelect';
import type { SchoolGrade } from '../../types/school';
import type { MajorModal } from '../../hooks/admin/useMajorScheduleActions';

export type BackdropProps = (
  onDismiss: () => void,
) => Pick<HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onClick'>;

export type MajorModalWizardProps = {
  majorModal: NonNullable<MajorModal>;
  setMajorModal: React.Dispatch<React.SetStateAction<MajorModal>>;
  majorModalStep: number;
  setMajorModalStep: React.Dispatch<React.SetStateAction<number>>;
  majorError: string;
  setMajorError: (message: string) => void;
  visibleGrades: SchoolGrade[];
  hasAllScope: boolean;
  backdropProps: BackdropProps;
  commitMajorModal: (onContinueToImport: () => void) => Promise<void> | void;
  setImportOpen: (open: boolean) => void;
};

export function MajorModalWizard({
  majorModal,
  setMajorModal,
  majorModalStep,
  setMajorModalStep,
  majorError,
  setMajorError,
  visibleGrades,
  hasAllScope,
  backdropProps,
  commitMajorModal,
  setImportOpen,
}: MajorModalWizardProps) {
  return (
    <AdminModalPortal className="admin-modal-overlay" {...backdropProps(() => setMajorModal(null))}>
      <div className="admin-modal admin-modal--wide admin-modal--workflow" onClick={(e) => e.stopPropagation()}>
        <h2 className="admin-modal__title admin-workflow-head">
          {majorModal.next === 'import'
            ? '先填写考试标题'
            : majorModal.mode === 'add'
              ? '新建大型考试'
              : '大型考试设置'}
        </h2>
        <AdminWorkflowClose
          onClick={() => {
            setMajorModal(null);
            setMajorError('');
          }}
        />
        {majorError && <div className="admin-error">{majorError}</div>}
        <div className="admin-workflow-layout">
          <AdminWizardSteps
            active={majorModalStep}
            steps={[
              { label: '考试名称', hint: '填写清晰的考试标题' },
              { label: '适用范围', hint: '确认下发年级' },
            ]}
            summary={
              <>
                <span>大型考试</span>
                <strong>{majorModal.name || '尚未命名'}</strong>
                <span>
                  {majorModal.targetGradeIds.length
                    ? visibleGrades.find((grade) => grade.id === majorModal.targetGradeIds[0])?.name || '指定年级'
                    : '全校统一'}
                </span>
              </>
            }
          />
          <div className="admin-workflow-content" key={majorModalStep}>
            {majorModalStep === 0 && (
              <div className="admin-workflow-pane">
                {majorModal.next === 'import' && (
                  <p className="admin-modal__body">
                    当前年级还没有大型考试。先填写标题，创建后将生成对应的 AI 识图提示词。
                  </p>
                )}
                <label className="admin-label">
                  考试名称
                  <input
                    className="admin-input"
                    autoFocus
                    value={majorModal.name}
                    onChange={(e) => setMajorModal((p) => p && { ...p, name: e.target.value })}
                    placeholder="如：2026年高考 / 高三一模"
                  />
                </label>
              </div>
            )}
            {majorModalStep === 1 && (
              <div className="admin-workflow-pane">
                <label className="admin-label">
                  <span className="with-help-tip">
                    适用范围
                    <HelpTip title="适用范围">默认归属当前年级；全校统一考试会出现在所有年级绑定设备上。</HelpTip>
                  </span>
                  <InlineSelect
                    className="admin-input"
                    value={majorModal.targetGradeIds.length ? majorModal.targetGradeIds[0] : 'all'}
                    onChange={(value) =>
                      setMajorModal((p) => p && { ...p, targetGradeIds: value === 'all' ? [] : [value] })
                    }
                    options={[
                      ...(hasAllScope ? [{ value: 'all', label: '全校统一' }] : []),
                      ...visibleGrades.map((grade) => ({ value: grade.id, label: grade.name })),
                    ]}
                  />
                </label>
                <div className="admin-workflow-review">
                  <span>
                    考试名称<strong>{majorModal.name}</strong>
                  </span>
                  <span>
                    显示范围
                    <strong>
                      {majorModal.targetGradeIds.length
                        ? visibleGrades.find((grade) => grade.id === majorModal.targetGradeIds[0])?.name || '指定年级'
                        : '全校统一'}
                    </strong>
                  </span>
                </div>
                <p className="admin-major-card__hint">
                  后台切换考试只改变编辑对象，不会覆盖大屏；客户端按绑定年级自动匹配。
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="admin-modal__actions">
          <button
            className="admin-btn"
            onClick={() => {
              if (majorModalStep) setMajorModalStep(0);
              else {
                setMajorModal(null);
                setMajorError('');
              }
            }}
          >
            {majorModalStep ? '上一步' : '取消'}
          </button>
          {majorModalStep === 0 ? (
            <button
              className="admin-btn admin-btn--primary admin-workflow-actions-spacer"
              onClick={() => {
                if (!majorModal.name.trim()) {
                  setMajorError('请输入大型考试名称');
                  return;
                }
                setMajorError('');
                setMajorModalStep(1);
              }}
            >
              下一步
            </button>
          ) : (
            <button
              className="admin-btn admin-btn--primary admin-workflow-actions-spacer"
              onClick={() => commitMajorModal(() => setImportOpen(true))}
            >
              {majorModal.next === 'import' ? '创建并继续导入' : '确认保存'}
            </button>
          )}
        </div>
      </div>
    </AdminModalPortal>
  );
}
