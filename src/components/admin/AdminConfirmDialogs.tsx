// 后台通用确认弹窗（删除大型考试/快速考试/批量条目/单个条目）。
import AdminModalPortal from '../AdminModalPortal';
import type { ExamItem, MajorExam } from '../../types';

export type BackdropProps = (
  onDismiss: () => void,
) => Pick<import('react').HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onClick'>;

export type DeleteMajorConfirmProps = {
  activeMajor: MajorExam;
  items: ExamItem[];
  removeMajor: () => void;
  setDeleteMajorOpen: (open: boolean) => void;
  backdropProps: BackdropProps;
};

export function DeleteMajorConfirm({
  activeMajor,
  items,
  removeMajor,
  setDeleteMajorOpen,
  backdropProps,
}: DeleteMajorConfirmProps) {
  return (
    <AdminModalPortal className="admin-modal-overlay" {...backdropProps(() => setDeleteMajorOpen(false))}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="admin-modal__title">删除大型考试</h2>
        <p className="admin-modal__body">
          确定删除「{activeMajor.name}」及其全部 {items.length} 项分考试？此操作无法撤销。
        </p>
        <div className="admin-modal__actions">
          <button className="admin-btn admin-btn--danger" onClick={removeMajor}>
            删除
          </button>
          <button className="admin-btn" onClick={() => setDeleteMajorOpen(false)}>
            取消
          </button>
        </div>
      </div>
    </AdminModalPortal>
  );
}

export type DeleteQuickMajorConfirmProps = {
  quickMajorDeleteTarget: MajorExam;
  removeQuickMajor: (major: MajorExam) => void;
  setQuickMajorDeleteTarget: (target: MajorExam | null) => void;
  backdropProps: BackdropProps;
};

export function DeleteQuickMajorConfirm({
  quickMajorDeleteTarget,
  removeQuickMajor,
  setQuickMajorDeleteTarget,
  backdropProps,
}: DeleteQuickMajorConfirmProps) {
  return (
    <AdminModalPortal className="admin-modal-overlay" {...backdropProps(() => setQuickMajorDeleteTarget(null))}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="admin-modal__title">删除临时考试</h2>
        <p className="admin-modal__body">确定删除“{quickMajorDeleteTarget.name}”吗？删除后无法恢复。</p>
        <div className="admin-modal__actions">
          <button className="admin-btn admin-btn--danger" onClick={() => removeQuickMajor(quickMajorDeleteTarget)}>
            删除
          </button>
          <button className="admin-btn" onClick={() => setQuickMajorDeleteTarget(null)}>
            取消
          </button>
        </div>
      </div>
    </AdminModalPortal>
  );
}

export type DeleteSelectedConfirmProps = {
  selectedItemIds: Set<string>;
  removeItems: (ids: string[]) => void;
  setDeleteSelectedOpen: (open: boolean) => void;
  backdropProps: BackdropProps;
};

export function DeleteSelectedConfirm({
  selectedItemIds,
  removeItems,
  setDeleteSelectedOpen,
  backdropProps,
}: DeleteSelectedConfirmProps) {
  return (
    <AdminModalPortal className="admin-modal-overlay" {...backdropProps(() => setDeleteSelectedOpen(false))}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="admin-modal__title">批量删除分考试</h2>
        <p className="admin-modal__body">确定删除选中的 {selectedItemIds.size} 项分考试？此操作无法撤销。</p>
        <div className="admin-modal__actions">
          <button className="admin-btn admin-btn--danger" onClick={() => removeItems([...selectedItemIds])}>
            删除
          </button>
          <button className="admin-btn" onClick={() => setDeleteSelectedOpen(false)}>
            取消
          </button>
        </div>
      </div>
    </AdminModalPortal>
  );
}

export type DeleteItemConfirmProps = {
  deleteTarget: ExamItem;
  remove: (item: ExamItem) => void;
  setDeleteTarget: (target: ExamItem | null) => void;
  backdropProps: BackdropProps;
};

export function DeleteItemConfirm({ deleteTarget, remove, setDeleteTarget, backdropProps }: DeleteItemConfirmProps) {
  return (
    <AdminModalPortal className="admin-modal-overlay" {...backdropProps(() => setDeleteTarget(null))}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="admin-modal__title">确认删除</h2>
        <p className="admin-modal__body">确定删除「{deleteTarget.name}」？此操作无法撤销。</p>
        <div className="admin-modal__actions">
          <button className="admin-btn admin-btn--danger" onClick={() => remove(deleteTarget)}>
            删除
          </button>
          <button className="admin-btn" onClick={() => setDeleteTarget(null)}>
            取消
          </button>
        </div>
      </div>
    </AdminModalPortal>
  );
}
