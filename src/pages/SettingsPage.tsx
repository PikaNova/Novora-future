import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  adminCan,
  getAdminUser,
  hasValidLocalToken,
  isLoginRequired,
  refreshAdminUser,
  type AdminUserContext,
} from "../services/examService";
import BatchPresetSettingsPanel from "../components/BatchPresetSettingsPanel";
import LoadingState from "../components/LoadingState";
import { APP_VERSION } from "../services/telemetry";
import "../styles/settings.css";
import AccessDenied from "../components/AccessDenied";
import AboutSection from "../components/settings/AboutSection";
import AnnouncementsSection from "../components/settings/AnnouncementsSection";
import TelemetrySection from "../components/settings/TelemetrySection";
import DeploymentSection from "../components/settings/DeploymentSection";
import SchoolInfoSection from "../components/settings/SchoolInfoSection";
import EmailServiceSection from "../components/settings/EmailServiceSection";
import WeeklyCalendarSection from "../components/settings/WeeklyCalendarSection";
import SubjectTrackModeSection from "../components/settings/SubjectTrackModeSection";
import TimeSyncSection from "../components/settings/TimeSyncSection";
import AlertsAdvancedSection from "../components/settings/AlertsAdvancedSection";
import DataMaintenanceSection from "../components/settings/DataMaintenanceSection";
import SettingsGroupNav from "../components/settings/SettingsGroupNav";
import SettingsCollapsibleCard from "../components/settings/SettingsCollapsibleCard";
import SystemStatusSection from "../components/settings/SystemStatusSection";
import { ArrowLeft, DatabaseZap, ListChecks, RadioTower, Rocket } from "lucide-react";

export default function SettingsPage() {
  const navigate = useNavigate();
  // 已有本地令牌时立即展示页面，跳过鉴权网络往返（数据库在新加坡、服务器在美国，
  // 跨洲往返会造成数秒白屏）；无令牌时才等待是否需要登录的判断。
  const [authed, setAuthed] = useState(() => hasValidLocalToken());
  const [adminUser, setAdminUser] = useState<AdminUserContext | null>(() =>
    getAdminUser(),
  );
  const [denied, setDenied] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (hasValidLocalToken()) {
      refreshAdminUser().then((user) => {
        if (!user) {
          navigate("/login?next=/settings", { replace: true });
          return;
        }
        if (user.mustChangePassword) {
          navigate("/admin?tab=users&password=1", { replace: true });
          return;
        }
        if (!adminCan("settings.read", user)) {
          setAdminUser(user);
          setAuthed(true);
          setDenied(true);
          return;
        }
        setAdminUser(user);
        setAuthed(true);
      });
      return;
    }
    isLoginRequired().then((required) => {
      if (!required) setAuthed(true);
      else navigate("/login?next=/settings", { replace: true });
    });
  }, [navigate]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const canEditSettings = adminUser
    ? adminCan("settings.edit", adminUser)
    : !hasValidLocalToken();
  const canEditWeekly = adminUser
    ? adminCan("weekly.edit", adminUser)
    : !hasValidLocalToken();
  const canReadAlerts = adminUser
    ? adminCan("alerts.read", adminUser)
    : !hasValidLocalToken();
  const canEditAlerts = adminUser
    ? adminCan("alerts.edit", adminUser)
    : !hasValidLocalToken();
  const canEditSchool = adminUser
    ? adminCan("initialization.run", adminUser)
    : !hasValidLocalToken();
  const canResetDatabase = adminUser
    ? adminUser.permissions.includes("*")
    : !hasValidLocalToken();

  const groups = [
    { id: "basic", label: "基础信息" },
    { id: "account", label: "登录与账号" },
    { id: "exam", label: "考试与排课" },
    { id: "runtime", label: "系统运行" },
    ...(canResetDatabase ? [{ id: "maintenance", label: "数据与维护" }] : []),
  ];

  if (!authed) return <LoadingState kind="auth" title="正在获取权限" message="正在确认系统设置权限…" />;
  if (denied)
    return (
      <AccessDenied moduleName="系统设置" onBack={() => navigate("/admin")} />
    );


  return (
    <div className={"set-page" + (scrolled ? " is-scrolled" : "")}>
      <header className="set-header">
        <div className="set-header__left">
          <button className="set-back" onClick={() => navigate("/admin")}>
            <ArrowLeft aria-hidden="true" />
            返回管理
          </button>
          <h1 className="set-title">系统设置</h1>
        </div>
        <span className="set-version">v{APP_VERSION}</span>
      </header>

      <div className="set-body">
        {!canEditSettings && (
          <div className="set-note set-note--warn">
            当前账号只能修改已授权的系统设置项，其余全局设置保持只读。如需修改登录密码，请前往“用户与权限”。
          </div>
        )}
        <div className="set-note set-note--local-hint">
          显示风格、动效与字体属于本机偏好，请前往
          <Link to="/local-settings">本地设置</Link>
          调整。
        </div>
        <SettingsGroupNav groups={groups} />

        <section id="set-group-basic" className="set-group" data-group="basic">
          <h2 className="set-group__title">基础信息</h2>
          <div className="set-group__body">
            <SchoolInfoSection canEditSchool={canEditSchool} />
            {canResetDatabase && <SystemStatusSection />}
            <SettingsCollapsibleCard
              storageKey="novora_set_collapse_deploy"
              title="版本与更新"
              icon={<Rocket size={18} />}
            >
              <DeploymentSection adminUser={adminUser} />
            </SettingsCollapsibleCard>
            <AnnouncementsSection />
          </div>
        </section>

        <section id="set-group-account" className="set-group" data-group="account">
          <h2 className="set-group__title">登录与账号</h2>
          <div className="set-group__body">
            <EmailServiceSection
              canEditSettings={canEditSettings}
              canEditPolicy={canResetDatabase}
            />
          </div>
        </section>

        <section id="set-group-exam" className="set-group" data-group="exam">
          <h2 className="set-group__title">考试与排课</h2>
          <div className="set-group__body">
            <WeeklyCalendarSection canEditWeekly={canEditWeekly} adminUser={adminUser} />
            <SubjectTrackModeSection canEditSettings={canEditSettings} />

            {/* ―― 批量添加分考试预设 ―― */}
            <section className="set-card">
              <h2 className="set-card__title">
                <ListChecks size={18} />
                批量添加分考试预设
              </h2>
              <p className="set-note">
                管理批量添加分考试时可复用的常用科目组和常用时间组，与批量添加弹窗中的设置共享，可在此新建、排序或删除。
              </p>
              <BatchPresetSettingsPanel canEdit={canEditSettings} />
            </section>
          </div>
        </section>

        <section id="set-group-runtime" className="set-group" data-group="runtime">
          <h2 className="set-group__title">系统运行</h2>
          <div className="set-group__body">
            <TimeSyncSection canEditSettings={canEditSettings} />
            <AlertsAdvancedSection
              canReadAlerts={canReadAlerts}
              canEditAlerts={canEditAlerts}
              canEditSettings={canEditSettings}
            />
            <SettingsCollapsibleCard
              storageKey="novora_set_collapse_telemetry"
              title="使用遥测"
              icon={<RadioTower size={18} />}
            >
              <TelemetrySection canEditSettings={canEditSettings} />
            </SettingsCollapsibleCard>
          </div>
        </section>

        {canResetDatabase && (
          <section id="set-group-maintenance" className="set-group" data-group="maintenance">
            <h2 className="set-group__title">数据与维护</h2>
            <div className="set-group__body">
              <SettingsCollapsibleCard
                storageKey="novora_set_collapse_maintenance"
                title="数据维护"
                icon={<DatabaseZap size={18} />}
                badge="危险操作"
                danger
              >
                <DataMaintenanceSection canResetDatabase={canResetDatabase} />
              </SettingsCollapsibleCard>
            </div>
          </section>
        )}

        {/* ―― 关于（置于页面最底部） ―― */}
        <AboutSection />
      </div>
    </div>
  );
}
