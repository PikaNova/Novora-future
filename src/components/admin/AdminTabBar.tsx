// 后台顶部标签栏：主功能切换 + 运行模式/年级/班级筛选。状态由 AdminPage 持有。
import { ADMIN_NAV } from '../../hooks/admin/useAdminModals';
import type { AdminTab, ScheduleMode } from '../../types/exam';
import type { SchoolGrade, SchoolClass } from '../../types/school';
import ModuleIcon from '../ModuleIcon';
import HelpTip from '../HelpTip';
import InlineSelect from '../InlineSelect';

export type AdminTabBarProps = {
  adminTab: AdminTab;
  can: (permission: string) => boolean;
  selectAdminTab: (item: (typeof ADMIN_NAV)[number]) => void;
  visibleWeeklyPlans: unknown[];
  scheduleMode: ScheduleMode;
  handleScheduleModeChange: (mode: ScheduleMode) => void;
  selectedGradeId: string;
  changeSelectedGrade: (gradeId: string) => void;
  visibleGrades: SchoolGrade[];
  selectedClassId: string;
  changeSelectedClass: (classId: string) => void;
  visibleClasses: SchoolClass[];
};

export function AdminTabBar({
  adminTab,
  can,
  selectAdminTab,
  visibleWeeklyPlans,
  scheduleMode,
  handleScheduleModeChange,
  selectedGradeId,
  changeSelectedGrade,
  visibleGrades,
  selectedClassId,
  changeSelectedClass,
  visibleClasses,
}: AdminTabBarProps) {
  return (
    <div className={`admin-tabbar${adminTab === 'major' || adminTab === 'weekly' ? ' has-context' : ''}`}>
      <div className="admin-tabbar__tabs">
        {ADMIN_NAV.filter((item) => item.id === 'users' || can(item.permission)).map((item) => (
          <button
            key={item.id}
            className={`admin-tab${adminTab === item.id ? ' is-active' : ''}`}
            onClick={() => selectAdminTab(item)}
            aria-current={adminTab === item.id ? 'page' : undefined}
          >
            <span>
              <ModuleIcon module={item.id} size={16} />
            </span>
            {item.label}
            {item.id === 'weekly' && visibleWeeklyPlans.length ? `（${visibleWeeklyPlans.length}）` : ''}
          </button>
        ))}
      </div>
      {adminTab !== 'overview' &&
        adminTab !== 'dashboard' &&
        adminTab !== 'devices' &&
        adminTab !== 'classes' &&
        adminTab !== 'users' && (
          <>
            <div className="admin-tabbar__modes">
              {can('schedule.mode_edit') && (
                <label className="admin-tabbar__mode">
                  <span className="admin-tabbar__mode-label with-help-tip">
                    <span>运行模式</span>
                    <HelpTip title="运行模式">
                      仅大型考试或仅周测会隐藏另一类安排；自动模式会同时调度，并按冲突规则让周测避开大型考试。
                    </HelpTip>
                  </span>
                  <InlineSelect
                    className="admin-input"
                    value={scheduleMode}
                    onChange={(value) => handleScheduleModeChange(value as ScheduleMode)}
                    options={[
                      { value: 'major-only', label: '仅大型考试' },
                      { value: 'weekly-only', label: '仅周测' },
                      {
                        value: 'automatic',
                        label: '自动（大型考试优先，自动避让周测）',
                      },
                    ]}
                  />
                </label>
              )}
              <label className="admin-tabbar__mode">
                年级
                <InlineSelect
                  className="admin-input"
                  value={selectedGradeId}
                  placeholder="请选择年级"
                  onChange={changeSelectedGrade}
                  options={[
                    { value: '', label: '请选择年级' },
                    ...visibleGrades.map((item) => ({
                      value: item.id,
                      label: item.name,
                    })),
                  ]}
                />
              </label>
              {adminTab === 'weekly' && (
                <label className="admin-tabbar__mode">
                  班级
                  <InlineSelect
                    className="admin-input"
                    value={selectedClassId}
                    placeholder="请选择班级"
                    onChange={changeSelectedClass}
                    disabled={!selectedGradeId}
                    options={[
                      { value: '', label: '请选择班级' },
                      ...visibleClasses
                        .filter((item) => item.gradeId === selectedGradeId)
                        .map((item) => ({ value: item.id, label: item.name })),
                    ]}
                  />
                </label>
              )}
            </div>
          </>
        )}
    </div>
  );
}
