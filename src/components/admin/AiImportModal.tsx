// AI 智能导入考试弹窗（准备内容 → 粘贴校验 → 预览导入）。状态与校验逻辑由 AdminPage/useMajorImportExport 持有。
import AdminModalPortal from '../AdminModalPortal';
import AdminWizardSteps, { AdminWorkflowClose } from '../AdminWizardSteps';
import AiImportGuide from '../AiImportGuide';
import { duration, fmtLocal } from '../../hooks/admin/adminPageUtils';
import type { ExamItem, MajorExam } from '../../types';

export type BackdropProps = (
  onDismiss: () => void,
) => Pick<import('react').HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onClick'>;

export type MajorImportPreview = {
  title: string;
  items: Array<ExamItem & { include: boolean }>;
  warnings: string[];
} | null;

export type AiImportModalProps = {
  importError: string;
  importText: string;
  majorImportPreview: MajorImportPreview;
  majorImportStep: number;
  openImportGuide: boolean;
  activeMajor: MajorExam;
  activeMajorScopeLabel: string;
  initialization: { schoolFullName?: string };
  backdropProps: BackdropProps;
  setImportOpen: (open: boolean) => void;
  setOpenImportGuide: (open: boolean) => void;
  setImportError: (message: string) => void;
  setImportText: (value: string) => void;
  setMajorImportPreview: React.Dispatch<React.SetStateAction<MajorImportPreview>>;
  setMajorImportStep: React.Dispatch<React.SetStateAction<number>>;
  validateMajorImportJson: () => void;
  importJson: () => void;
};

export function AiImportModal({
  importError,
  importText,
  majorImportPreview,
  majorImportStep,
  openImportGuide,
  activeMajor,
  activeMajorScopeLabel,
  initialization,
  backdropProps,
  setImportOpen,
  setOpenImportGuide,
  setImportError,
  setImportText,
  setMajorImportPreview,
  setMajorImportStep,
  validateMajorImportJson,
  importJson,
}: AiImportModalProps) {
  return (
    <AdminModalPortal
      className="admin-modal-overlay"
      {...backdropProps(() => {
        setImportOpen(false);
        setOpenImportGuide(false);
      })}
    >
      <div className="admin-modal admin-modal--wide admin-modal--workflow" onClick={(e) => e.stopPropagation()}>
        <h2 className="admin-modal__title admin-workflow-head">AI智能导入考试</h2>
        <AdminWorkflowClose
          onClick={() => {
            setImportOpen(false);
            setOpenImportGuide(false);
            setImportError('');
            setMajorImportPreview(null);
          }}
        />
        {importError && <div className="admin-error">{importError}</div>}
        <div className="admin-workflow-layout">
          <AdminWizardSteps
            active={majorImportStep}
            steps={[
              { label: '准备内容', hint: '查看格式或生成提示词' },
              { label: '粘贴校验', hint: '解析分考试 JSON' },
              { label: '预览结果', hint: '检查风险后导入' },
            ]}
            summary={
              <>
                <span>导入到</span>
                <strong>{majorImportPreview?.title || activeMajor.name}</strong>
                <span>
                  {majorImportPreview
                    ? `${majorImportPreview.items.filter((item) => item.include).length} 项待导入`
                    : activeMajorScopeLabel}
                </span>
              </>
            }
          />
          <div className="admin-workflow-content" key={majorImportStep}>
            {majorImportStep === 0 && (
              <div className="admin-workflow-pane">
                <p className="admin-modal__body">
                  支持纯数组，或含 <code>title</code> 与 <code>items</code> 的对象。导入时会校验字段并按开始时间排序。
                </p>
                <AiImportGuide
                  kind="major"
                  context={`${initialization.schoolFullName || '当前学校'}，${activeMajorScopeLabel}，大型考试“${activeMajor.name}”`}
                  targetTitle={activeMajor.name}
                  initiallyOpen={openImportGuide}
                />
              </div>
            )}
            {majorImportStep === 1 && (
              <div className="admin-workflow-pane">
                <label className="admin-label">
                  考试安排 JSON
                  <textarea
                    className="admin-textarea"
                    rows={11}
                    value={importText}
                    onChange={(e) => {
                      setImportText(e.target.value);
                      setMajorImportPreview(null);
                    }}
                    placeholder='{"title":"2026年高考","items":[{"name":"语文","startTime":"2026-06-07T09:00:00","endTime":"2026-06-07T11:30:00","enabled":true}]}'
                  />
                </label>
              </div>
            )}
            {majorImportStep === 2 && majorImportPreview && (
              <div className="admin-workflow-pane">
                <h3 className="admin-modal__title">预览导入结果</h3>
                {majorImportPreview.warnings.length ? (
                  <div className="admin-error">{majorImportPreview.warnings.join('；')}</div>
                ) : (
                  <p className="admin-major-card__hint">时间格式和顺序校验通过。取消勾选可跳过单项。</p>
                )}
                <div className="admin-import-preview">
                  {majorImportPreview.items.map((item, index) => (
                    <label key={`${item.id}-${index}`} className={item.include ? '' : 'is-skipped'}>
                      <input
                        type="checkbox"
                        checked={item.include}
                        onChange={(event) =>
                          setMajorImportPreview(
                            (value) =>
                              value && {
                                ...value,
                                items: value.items.map((current, itemIndex) =>
                                  itemIndex === index ? { ...current, include: event.target.checked } : current,
                                ),
                              },
                          )
                        }
                      />
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {fmtLocal(item.startTime)} - {fmtLocal(item.endTime)} ·{' '}
                          {duration(item.startTime, item.endTime)}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="admin-modal__actions">
          <button
            className="admin-btn"
            onClick={() => {
              if (majorImportStep) setMajorImportStep((value) => value - 1);
              else {
                setImportOpen(false);
                setOpenImportGuide(false);
                setImportError('');
                setMajorImportPreview(null);
              }
            }}
          >
            {majorImportStep ? '上一步' : '取消'}
          </button>
          {majorImportStep === 0 ? (
            <button
              className="admin-btn admin-btn--primary admin-workflow-actions-spacer"
              onClick={() => setMajorImportStep(1)}
            >
              下一步，粘贴 JSON
            </button>
          ) : majorImportStep === 1 ? (
            <button
              className="admin-btn admin-btn--primary admin-workflow-actions-spacer"
              onClick={validateMajorImportJson}
            >
              校验并预览
            </button>
          ) : (
            <button
              className="admin-btn admin-btn--primary admin-workflow-actions-spacer"
              disabled={!majorImportPreview?.items.some((item) => item.include)}
              onClick={importJson}
            >
              确认导入 {majorImportPreview?.items.filter((item) => item.include).length || 0} 项
            </button>
          )}
        </div>
      </div>
    </AdminModalPortal>
  );
}
