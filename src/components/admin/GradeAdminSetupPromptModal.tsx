// 年级管理员首次登录的“快速添加班级管理员”引导弹窗。
import AdminModalPortal from '../AdminModalPortal';
import { clearGradeAdminSetupPrompt } from '../../services/examService';
import type { SchoolGrade } from '../../types/school';
import type { AdminTab } from '../../types/exam';

export type GradeAdminSetupPromptModalProps = {
  visibleGrades: SchoolGrade[];
  setGradeAdminSetupPromptOpen: (open: boolean) => void;
  setAdminTab: (tab: AdminTab) => void;
};

export function GradeAdminSetupPromptModal({
  visibleGrades,
  setGradeAdminSetupPromptOpen,
  setAdminTab,
}: GradeAdminSetupPromptModalProps) {
  return (
    <AdminModalPortal className="admin-modal-overlay">
      <div className="admin-modal" onClick={(event) => event.stopPropagation()}>
        <h2 className="admin-modal__title">快速添加班级管理员</h2>
        <p className="admin-modal__body">
          这是该年级管理员账号首次登录。可为授权年级下的各班创建班级管理员账号，让每位管理员只维护自己的班级。
        </p>
        <p className="admin-major-card__hint">
          可管理范围：
          {visibleGrades.map((grade) => grade.name).join('、') || '当前授权年级'}
          。创建账号时选择“班级管理员”角色，并勾选对应班级。
        </p>
        <div className="admin-modal__actions">
          <button
            className="admin-btn admin-btn--primary"
            onClick={() => {
              clearGradeAdminSetupPrompt();
              setGradeAdminSetupPromptOpen(false);
              setAdminTab('users');
            }}
          >
            前往添加账号
          </button>
          <button
            className="admin-btn"
            onClick={() => {
              clearGradeAdminSetupPrompt();
              setGradeAdminSetupPromptOpen(false);
            }}
          >
            稍后处理
          </button>
        </div>
      </div>
    </AdminModalPortal>
  );
}
