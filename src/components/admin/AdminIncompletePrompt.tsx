// 应急进入管理页时的“初始化未完整”提示条。
export type AdminIncompletePromptProps = {
  initialization: { completedAt?: number | null; schoolFullName?: string };
  grades: unknown[];
  classes: unknown[];
  recoveryConfigured: boolean | null;
  onContinue: () => void;
  onOpenClasses: () => void;
};

export function AdminIncompletePrompt({
  initialization,
  grades,
  classes,
  recoveryConfigured,
  onContinue,
  onOpenClasses,
}: AdminIncompletePromptProps) {
  return (
    <aside className="admin-incomplete-prompt" role="alert" aria-live="assertive">
      <strong>初始化尚未完整完成</strong>
      <p>这是应急进入管理页模式。以下设置仍需补充，提醒会一直保留：</p>
      <ul>
        {!initialization.schoolFullName && <li>学校名称与省份</li>}
        {grades.length === 0 && <li>至少一个年级</li>}
        {classes.length === 0 && <li>至少一个班级</li>}
        {!initialization.completedAt && <li>学期、调度规则和初始化确认</li>}
        {recoveryConfigured === false && <li>自动生成并安全保存超级管理员恢复密钥</li>}
      </ul>
      <div>
        <button className="admin-btn admin-btn--primary" onClick={onContinue}>
          继续完整初始化
        </button>
        <button className="admin-btn" onClick={onOpenClasses}>
          打开年级与班级
        </button>
      </div>
      <small>补齐全部项目后，请使用普通管理地址重新登录。</small>
    </aside>
  );
}
