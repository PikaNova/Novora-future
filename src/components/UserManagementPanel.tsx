import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SchoolClass, SchoolGrade } from "../types/school";
import AdminModalPortal from './AdminModalPortal';
import Mascot from './Mascot';
import {
  getAdminUser,
  logoutAdmin,
  type AdminScope,
  type AdminUserContext,
} from "../services/examService";
import {
  changeOwnPassword,
  changeOwnCredentials,
  changeOwnUsername,
  deleteManagedUser,
  deleteManagedRole,
  fetchAuditLogs,
  fetchUserManagement,
  resetManagedUserPassword,
  saveManagedRole,
  saveManagedUser,
  type AuditLog,
  type ManagedRole,
  type ManagedUser,
  AdminApiError,
} from "../services/adminUsers";
import ClassMultiPicker, { type ClassPickerOption } from "./ClassMultiPicker";
import InlineSelect from "./InlineSelect";
import AdminWizardSteps, { AdminWorkflowClose } from "./AdminWizardSteps";
import AccountEmailBinding from "./AccountEmailBinding";
import { confirmDialog } from "../services/appDialog";
import {
  ROLE_MODULES,
  moduleLevel,
  PERMISSION_GROUPS,
  PERMISSION_META,
  ACTION_LABEL,
  permissionMeta,
  type RoleLevel,
} from "../constants/permissions";
import {
  computeUserManagementPermissionFlags,
  computeUserManagementScopeAccess,
} from "../services/userManagementAccess";

type Props = {
  grades: SchoolGrade[];
  classes: SchoolClass[];
  currentUser?: AdminUserContext | null;
  forcePasswordChange?: boolean;
  openBatchCreate?: boolean;
};
type Section = "users" | "roles" | "audit";
type UserDraft = {
  id?: number;
  username: string;
  displayName: string;
  password: string;
  roleId: string;
  status: "active" | "disabled";
  allScope: boolean;
  gradeIds: string[];
  classIds: string[];
};
type RoleDraft = {
  id?: string;
  name: string;
  description: string;
  permissions: string[];
};
type PasswordDraft = {
  current: string;
  username: string;
  next: string;
  confirm: string;
};
type BatchUserDraft = { prefix: string; password: string; classIds: string[] };
type BatchCredential = {
  displayName: string;
  username: string;
  password: string;
  gradeName: string;
  className: string;
};
const fmt = (value?: number | null) =>
  value
    ? new Date(Number(value)).toLocaleString("zh-CN", { hour12: false })
    : "从未登录";
const generateTemporaryPassword = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const values = new Uint32Array(14);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join(
    "",
  );
};

function scopeText(
  user: ManagedUser,
  grades: SchoolGrade[],
  classes: SchoolClass[],
) {
  if (user.scopes.some((scope) => scope.type === "all")) return "全校";
  const names = user.scopes.map((scope) =>
    scope.type === "grade"
      ? grades.find((item) => item.id === scope.gradeId)?.name
      : `${grades.find((item) => item.id === scope.gradeId)?.name ?? "未知年级"} · ${classes.find((item) => item.id === scope.classId)?.name ?? "未知班级"}`,
  );
  return names.filter(Boolean).join("、") || "未分配范围";
}

function draftScopes(draft: UserDraft, classes: SchoolClass[]): AdminScope[] {
  if (draft.allScope) return [{ type: "all", gradeId: "", classId: "" }];
  if (draft.roleId === "class_admin") {
    return draft.classIds.map((classId) => ({
      type: "class" as const,
      gradeId: classes.find((item) => item.id === classId)?.gradeId ?? "",
      classId,
    }));
  }
  return [
    ...draft.gradeIds.map((gradeId) => ({
      type: "grade" as const,
      gradeId,
      classId: "",
    })),
    ...draft.classIds.map((classId) => ({
      type: "class" as const,
      gradeId: classes.find((item) => item.id === classId)?.gradeId ?? "",
      classId,
    })),
  ];
}

function validateUserDraftFields(draft: UserDraft) {
  const errors: Record<string, string> = {};
  if (!draft.id && !/^[A-Za-z0-9._-]{3,40}$/.test(draft.username.trim()))
    errors.username = "请输入 3-40 位字母、数字、点、横线或下划线";
  if (!draft.displayName.trim()) errors.displayName = "请输入显示名称";
  if (!draft.id && draft.password.length < 8)
    errors.password = "初始密码至少需要 8 位";
  if (!draft.roleId) errors.roleId = "请选择角色";
  return errors;
}
function validateUserScopes(draft: UserDraft) {
  if (draft.roleId === "super_admin" || draft.allScope) return "";
  if (draft.roleId === "class_admin" && !draft.classIds.length)
    return "班级管理员必须选择至少一个具体班级";
  if (draft.roleId === "grade_admin" && !draft.gradeIds.length)
    return "年级管理员必须选择至少一个年级";
  if (!draft.gradeIds.length && !draft.classIds.length)
    return "至少选择一个年级或班级";
  return "";
}

export default function UserManagementPanel({
  grades,
  classes,
  currentUser,
  forcePasswordChange = false,
  openBatchCreate = false,
}: Props) {
  const navigate = useNavigate();
  const current = currentUser ?? getAdminUser();
  const {
    canReadUsers,
    canCreateUser,
    canEditUser,
    canResetPassword,
    canDeleteUser,
    canManageRoles,
    canReadAudit,
  } = computeUserManagementPermissionFlags(current);
  const [section, setSection] = useState<Section>("users");
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<ManagedRole[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(
    canReadUsers && !current?.mustChangePassword,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [userDraft, setUserDraft] = useState<UserDraft | null>(null);
  const [userWizardStep, setUserWizardStep] = useState(0);
  const [batchUserDraft, setBatchUserDraft] = useState<BatchUserDraft | null>(
    null,
  );
  const [batchUserWizardStep, setBatchUserWizardStep] = useState(0);
  const [batchCredentials, setBatchCredentials] = useState<
    BatchCredential[] | null
  >(null);
  const [userErrors, setUserErrors] = useState<Record<string, string>>({});
  const [roleError, setRoleError] = useState("");
  const [batchUserError, setBatchUserError] = useState("");
  const [roleDraft, setRoleDraft] = useState<RoleDraft | null>(null);
  const [roleWizardStep, setRoleWizardStep] = useState(0);
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetMode, setResetMode] = useState<"generated" | "manual">(
    "generated",
  );
  const [issuedPassword, setIssuedPassword] = useState<{
    displayName: string;
    password: string;
  } | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(
    forcePasswordChange || current?.mustChangePassword === true,
  );
  const [passwordDraft, setPasswordDraft] = useState<PasswordDraft>({
    current: "",
    username: current?.username ?? "",
    next: "",
    confirm: "",
  });
  const [usernameOpen, setUsernameOpen] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState({
    currentPassword: "",
    username: current?.username ?? "",
  });
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>(
    {},
  );
  const [usernameError, setUsernameError] = useState("");
  const [resetError, setResetError] = useState("");
  const [batchDeleteMode, setBatchDeleteMode] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [batchDeleteGradeId, setBatchDeleteGradeId] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [menuUser, setMenuUser] = useState<string | null>(null);
  const [menuRect, setMenuRect] = useState<{ left: number; top: number } | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [matrixDraft, setMatrixDraft] = useState<RoleDraft | null>(null);

  const load = async () => {
    if (!canReadUsers || current?.mustChangePassword) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const data = await fetchUserManagement();
      setUsers(data.users);
      setRoles(data.roles);
      setPermissions(data.permissions);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "用户数据加载失败");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (userDraft) setUserWizardStep(0);
  }, [userDraft !== null]);
  useEffect(() => {
    if (roleDraft) setRoleWizardStep(0);
  }, [roleDraft !== null]);
  useEffect(() => {
    if (batchUserDraft) setBatchUserWizardStep(0);
  }, [batchUserDraft !== null]);
  useEffect(() => {
    if (forcePasswordChange || current?.mustChangePassword)
      setPasswordOpen(true);
  }, [forcePasswordChange, current?.mustChangePassword]);
  useEffect(() => {
    if (openBatchCreate && canCreateUser)
      setBatchUserDraft({ prefix: "class_admin", password: "", classIds: [] });
  }, [canCreateUser, openBatchCreate]);
  useEffect(() => {
    if (section !== "audit") return;
    fetchAuditLogs()
      .then(setLogs)
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : "日志加载失败"),
      );
  }, [section]);

  const groupedPermissions = useMemo(
    () =>
      PERMISSION_GROUPS.map((group) => ({
        ...group,
        items: permissions.filter((item) => item.startsWith(group.prefix)),
      })).filter((group) => group.items.length),
    [permissions],
  );
  const {
    canAssignAll,
    visibleGradeIds,
    visibleClassIds,
    visibleGrades,
    visibleClasses,
    delegableRoles,
  } = computeUserManagementScopeAccess(current, roles, grades, classes);
  const classPickerOptions = useMemo<ClassPickerOption[]>(
    () =>
      visibleClasses.map((item) => ({
        id: item.id,
        gradeId: item.gradeId,
        gradeName:
          grades.find((grade) => grade.id === item.gradeId)?.name ?? "未知年级",
        className: item.name,
      })),
    [grades, visibleClasses],
  );
  const beginCreateUser = () => {
    setUserErrors({});
    setUserDraft({
      username: "",
      displayName: "",
      password: "",
      roleId:
        delegableRoles.find((role) => role.id === "viewer")?.id ??
        delegableRoles[0]?.id ??
        "",
      status: "active",
      allScope: false,
      gradeIds: [],
      classIds: [],
    });
  };
  const beginEditUser = (user: ManagedUser) => {
    setUserErrors({});
    setUserDraft({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      password: "",
      roleId: user.roleId,
      status: user.status,
      allScope: user.scopes.some((scope) => scope.type === "all"),
      gradeIds: user.scopes
        .filter((scope) => scope.type === "grade")
        .map((scope) => scope.gradeId),
      classIds: user.scopes
        .filter((scope) => scope.type === "class")
        .map((scope) => scope.classId),
    });
  };

  const submitUser = async () => {
    if (!userDraft) return;
    const errors = validateUserDraftFields(userDraft);
    const scopeError = validateUserScopes(userDraft);
    if (scopeError) errors.scopes = scopeError;
    if (Object.keys(errors).length) {
      setUserErrors(errors);
      if (errors.scopes) setUserWizardStep(1);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const next = await saveManagedUser({
        action: userDraft.id ? "update" : "create",
        id: userDraft.id,
        username: userDraft.username,
        displayName: userDraft.displayName,
        password: userDraft.password,
        roleId: userDraft.roleId,
        status: userDraft.status,
        scopes: draftScopes(userDraft, classes),
      });
      setUsers(next);
      setUserDraft(null);
      setMessage(
        userDraft.id
          ? "用户权限已更新，原登录会话已失效。"
          : "用户已创建，首次登录必须修改密码。",
      );
    } catch (error) {
      if (error instanceof AdminApiError && error.field) {
        setUserErrors({ [error.field]: error.message });
        if (error.field === "scopes") setUserWizardStep(1);
      } else setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  const submitBatchUsers = async () => {
    if (!batchUserDraft?.classIds.length) {
      setMessage("请至少选择一个班级。");
      return;
    }
    if (!/^[A-Za-z0-9._-]{2,30}$/.test(batchUserDraft.prefix)) {
      setMessage("账号前缀需为 2-30 位字母、数字、点、横线或下划线。");
      return;
    }
    if (batchUserDraft.password.length < 8) {
      setMessage("批量账号初始密码至少需要 8 位。");
      return;
    }
    if (!delegableRoles.some((role) => role.id === "class_admin")) {
      setMessage("当前账号不能下发班级管理员角色。");
      return;
    }
    setBusy(true);
    setMessage("");
    let completed = 0;
    let latest = users;
    const created: BatchCredential[] = [];
    try {
      for (const classId of batchUserDraft.classIds) {
        const schoolClass = classes.find((item) => item.id === classId)!;
        const grade = grades.find((item) => item.id === schoolClass.gradeId);
        const suffix = String(
          classes
            .filter((item) => item.gradeId === schoolClass.gradeId)
            .findIndex((item) => item.id === classId) + 1,
        ).padStart(2, "0");
        const gradeIndex = String(
          grades.findIndex((item) => item.id === schoolClass.gradeId) + 1,
        );
        latest = await saveManagedUser({
          action: "create",
          username: `${batchUserDraft.prefix}_g${gradeIndex}c${suffix}`,
          displayName: `${grade?.name ?? ""}${schoolClass.name}管理员`,
          password: batchUserDraft.password,
          roleId: "class_admin",
          status: "active",
          scopes: [{ type: "class", gradeId: schoolClass.gradeId, classId }],
        });
        created.push({
          displayName: `${grade?.name ?? ""}${schoolClass.name}管理员`,
          username: `${batchUserDraft.prefix}_g${gradeIndex}c${suffix}`,
          password: batchUserDraft.password,
          gradeName: grade?.name ?? "",
          className: schoolClass.name,
        });
        completed += 1;
      }
      setUsers(latest);
      setBatchUserDraft(null);
      setBatchCredentials(created);
      setMessage(
        `已创建 ${completed} 个班级管理员账号，首次登录均需设置自己的用户名和新密码。`,
      );
    } catch (error) {
      setUsers(latest);
      setMessage(
        `已创建 ${completed} 个账号，随后停止：${error instanceof Error ? error.message : "创建失败"}`,
      );
    } finally {
      setBusy(false);
    }
  };
  const exportBatchCredentials = () => {
    if (!batchCredentials?.length) return;
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = [
      ["管理员", "用户名", "初始密码", "年级", "班级", "首次登录要求"],
      ...batchCredentials.map((item) => [
        item.displayName,
        item.username,
        item.password,
        item.gradeName,
        item.className,
        "修改用户名和密码",
      ]),
    ];
    const file = new Blob(
      [`\uFEFF${rows.map((row) => row.map(quote).join(",")).join("\r\n")}`],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Novora-班级管理员初始账号-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const submitRole = async () => {
    if (!roleDraft) return;
    setBusy(true);
    setMessage("");
    try {
      setRoles(await saveManagedRole(roleDraft));
      setRoleDraft(null);
      setMessage("角色权限已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "角色保存失败");
    } finally {
      setBusy(false);
    }
  };
  const toggleMenu = (
    event: React.MouseEvent<HTMLButtonElement>,
    user: ManagedUser,
  ) => {
    if (menuUser === String(user.id)) {
      setMenuUser(null);
      setMenuRect(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuRect({ left: rect.right, top: rect.bottom });
    setMenuUser(String(user.id));
  };
  useEffect(() => {
    if (!menuUser) return;
    const close = () => {
      setMenuUser(null);
      setMenuRect(null);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menuUser]);

  const selectRole = (role: ManagedRole) => {
    setSelectedRoleId(role.id);
    setMatrixDraft(
      role.builtIn
        ? null
        : {
            id: role.id,
            name: role.name,
            description: role.description,
            permissions: role.permissions,
          },
    );
  };
  const setMatrixModuleLevel = (
    module: (typeof ROLE_MODULES)[number],
    level: RoleLevel,
  ) =>
    setMatrixDraft((value) => {
      if (!value) return value;
      const modulePermissions = [...module.read, ...module.manage];
      const retained = value.permissions.filter(
        (item) => !modulePermissions.includes(item),
      );
      const added =
        level === "none"
          ? []
          : level === "read"
            ? module.read
            : [...module.read, ...module.manage];
      return {
        ...value,
        permissions: [...new Set([...retained, ...added])],
      };
    });
  const saveMatrixRole = async () => {
    if (!matrixDraft) return;
    setBusy(true);
    setMessage("");
    try {
      const next = await saveManagedRole(matrixDraft);
      setRoles(next);
      const saved = next.find((role) => role.id === matrixDraft.id);
      setMatrixDraft(
        saved
          ? {
              id: saved.id,
              name: saved.name,
              description: saved.description,
              permissions: saved.permissions,
            }
          : null,
      );
      setMessage("角色权限已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "角色保存失败");
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async () => {
    if (!resetTarget || resetPassword.length < 8) {
      setResetError("新密码至少需要 8 位");
      return;
    }
    setBusy(true);
    try {
      const issued = {
        displayName: resetTarget.displayName,
        password: resetPassword,
      };
      await resetManagedUserPassword(resetTarget.id, resetPassword);
      setResetTarget(null);
      setResetPassword("");
      setResetError("");
      setIssuedPassword(issued);
      setCopyStatus("");
      setMessage("密码已重置，该用户需要重新登录并修改密码。");
    } catch (error) {
      setResetError(error instanceof Error ? error.message : "重置失败");
    } finally {
      setBusy(false);
    }
  };
  const submitOwnPassword = async () => {
    const errors: Record<string, string> = {};
    const requiresInitialUpdate =
      forcePasswordChange || current?.mustChangePassword;
    if (!passwordDraft.current) errors.current = "请输入当前密码";
    if (
      requiresInitialUpdate &&
      !/^[A-Za-z0-9._-]{3,40}$/.test(passwordDraft.username.trim())
    )
      errors.username = "用户名需为 3-40 位字母、数字、点、横线或下划线";
    if (
      requiresInitialUpdate &&
      current?.roleId === "class_admin" &&
      passwordDraft.username.trim().toLowerCase() ===
        current.username.toLowerCase()
    )
      errors.username = "班级管理员首次登录必须设置新的用户名";
    if (passwordDraft.next.length < 8) errors.next = "新密码至少需要 8 位";
    if (passwordDraft.next !== passwordDraft.confirm)
      errors.confirm = "两次输入的新密码不一致";
    if (Object.keys(errors).length) {
      setPasswordErrors(errors);
      return;
    }
    setBusy(true);
    setPasswordErrors({});
    try {
      if (requiresInitialUpdate)
        await changeOwnCredentials(
          passwordDraft.current,
          passwordDraft.username.trim(),
          passwordDraft.next,
        );
      else await changeOwnPassword(passwordDraft.current, passwordDraft.next);
      logoutAdmin();
      navigate("/login?next=/admin", { replace: true });
    } catch (error) {
      setPasswordErrors({
        current: error instanceof Error ? error.message : "密码修改失败",
      });
      setBusy(false);
    }
  };
  const submitOwnUsername = async () => {
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(usernameDraft.username.trim())) {
      setUsernameError("用户名需为 3-40 位字母、数字、点、横线或下划线");
      return;
    }
    if (!usernameDraft.currentPassword) {
      setUsernameError("请输入当前登录密码以验证身份");
      return;
    }
    setBusy(true);
    setUsernameError("");
    try {
      await changeOwnUsername(
        usernameDraft.currentPassword,
        usernameDraft.username.trim(),
      );
      logoutAdmin();
      navigate("/login?next=/admin", { replace: true });
    } catch (error) {
      setUsernameError(
        error instanceof Error ? error.message : "用户名修改失败",
      );
      setBusy(false);
    }
  };

  const setRoleModuleLevel = (
    module: (typeof ROLE_MODULES)[number],
    level: RoleLevel,
  ) =>
    setRoleDraft((value) => {
      if (!value) return value;
      const modulePermissions = [...module.read, ...module.manage];
      const retained = value.permissions.filter(
        (item) => !modulePermissions.includes(item),
      );
      const added =
        level === "none"
          ? []
          : level === "read"
            ? module.read
            : [...module.read, ...module.manage];
      return { ...value, permissions: [...new Set([...retained, ...added])] };
    });

  const removeUser = async (user: ManagedUser) => {
    if (
      !(await confirmDialog({
        title: `删除管理员“${user.displayName}”`,
        message: "该账号会立即退出所有设备，且无法恢复。",
        tone: "danger",
        confirmLabel: "删除管理员",
      }))
    )
      return;
    try {
      setUsers(await deleteManagedUser(user.id));
      setMessage(`管理员“${user.displayName}”已删除。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除用户失败");
    }
  };
  const removableUsers = users.filter((user) => user.id !== current?.id);
  const batchDeleteUsers = useMemo(
    () =>
      batchDeleteGradeId
        ? removableUsers.filter((user) =>
            user.scopes.some(
              (scope) =>
                scope.type !== "all" && scope.gradeId === batchDeleteGradeId,
            ),
          )
        : removableUsers,
    [batchDeleteGradeId, removableUsers],
  );
  const BUILTIN_GROUP_ORDER = [
    "super_admin",
    "grade_admin",
    "class_admin",
    "viewer",
  ];
  const groupUsersByRole = (userList: ManagedUser[]) => {
    const groups = new Map<
      string,
      { key: string; name: string; builtIn: boolean; users: ManagedUser[] }
    >();
    for (const user of userList) {
      const builtIn = BUILTIN_GROUP_ORDER.includes(user.roleId);
      const existing = groups.get(user.roleId);
      if (existing) existing.users.push(user);
      else
        groups.set(user.roleId, {
          key: user.roleId,
          name: user.roleName || user.roleId,
          builtIn,
          users: [user],
        });
    }
    return [...groups.values()].sort((a, b) => {
      const aIndex = BUILTIN_GROUP_ORDER.indexOf(a.key);
      const bIndex = BUILTIN_GROUP_ORDER.indexOf(b.key);
      const aOrder = aIndex >= 0 ? aIndex : BUILTIN_GROUP_ORDER.length;
      const bOrder = bIndex >= 0 ? bIndex : BUILTIN_GROUP_ORDER.length;
      return aOrder - bOrder || a.name.localeCompare(b.name, "zh-CN");
    });
  };
  const groupsInitialized = useRef(false);
  useEffect(() => {
    if (groupsInitialized.current || !users.length) return;
    groupsInitialized.current = true;
    const currentRoleName =
      users.find((user) => user.id === current?.id)?.roleName ?? "";
    setCollapsedGroups((prev) => {
      const next = { ...prev };
      for (const group of groupUsersByRole(users)) {
        if (!(group.key in next))
          next[group.key] = group.name !== currentRoleName;
      }
      return next;
    });
  }, [users, current?.id]);
  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return users.filter((user) => {
      if (
        query &&
        !user.displayName.toLowerCase().includes(query) &&
        !user.username.toLowerCase().includes(query)
      )
        return false;
      if (roleFilter && user.roleId !== roleFilter) return false;
      if (statusFilter && user.status !== statusFilter) return false;
      return true;
    });
  }, [users, searchQuery, roleFilter, statusFilter]);
  const userGroups = useMemo(
    () => groupUsersByRole(batchDeleteMode ? batchDeleteUsers : filteredUsers),
    [batchDeleteMode, batchDeleteUsers, filteredUsers],
  );
  const selectedRole = useMemo(
    () => roles.find((role) => role.id === selectedRoleId) ?? null,
    [roles, selectedRoleId],
  );
  useEffect(() => {
    if (!roles.length) return;
    setSelectedRoleId((id) =>
      id && roles.some((role) => role.id === id) ? id : roles[0].id,
    );
  }, [roles]);
  const rolePermissionGroups = (
    role: ManagedRole,
    draft: RoleDraft | null,
  ) => {
    const permissions =
      draft && draft.id === role.id ? draft.permissions : role.permissions;
    return groupedPermissions
      .map((group) => ({
        ...group,
        items: permissions.includes("*")
          ? group.items
          : group.items.filter((item) => permissions.includes(item)),
      }))
      .filter((group) => group.items.length);
  };

  const removeSelectedUsers = async () => {
    const targets = removableUsers.filter((user) => selectedUserIds.includes(user.id));
    if (!targets.length) return;
    if (!(await confirmDialog({ title: `删除 ${targets.length} 个管理员账号`, message: "删除后将立即撤销这些账号的会话，且无法恢复。", tone: "danger", confirmLabel: "删除所选账号" }))) return;
    setBusy(true);
    const failed: number[] = [];
    let nextUsers = users;
    for (const target of targets) {
      try { nextUsers = await deleteManagedUser(target.id); }
      catch { failed.push(target.id); }
    }
    setUsers(nextUsers);
    setSelectedUserIds(failed);
    setBusy(false);
    setMessage(failed.length ? `已删除 ${targets.length - failed.length} 个账号；${failed.length} 个账号删除失败，请重试。` : `已删除 ${targets.length} 个账号。`);
    if (!failed.length) setBatchDeleteMode(false);
  };
  const removeRole = async (role: ManagedRole) => {
    if (
      !(await confirmDialog({
        title: `删除角色“${role.name}”`,
        message: "删除后无法再将该角色分配给管理员。",
        tone: "danger",
        confirmLabel: "删除角色",
      }))
    )
      return;
    try {
      setRoles(await deleteManagedRole(role.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    }
  };

  return (
    <main className="user-management">
      {batchUserDraft && (
        <AdminModalPortal className="admin-modal-overlay">
          <div
            className="admin-modal admin-modal--wide admin-modal--workflow"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="admin-modal__title admin-workflow-head">批量添加班级管理员</h2>
            <AdminWorkflowClose onClick={() => setBatchUserDraft(null)} />
            <div className="admin-workflow-layout">
              <AdminWizardSteps
                active={batchUserWizardStep}
                steps={[
                  { label: "账号规则", hint: "前缀和初始密码" },
                  { label: "选择班级", hint: "批量指定目标班级" },
                  { label: "确认创建", hint: "生成并导出账号" },
                ]}
                summary={<><span>将创建</span><strong>{batchUserDraft.classIds.length} 个账号</strong><span>前缀：{batchUserDraft.prefix || "未填写"}</span></>}
              />
              <div className="admin-workflow-content" key={batchUserWizardStep}>
            {batchUserWizardStep === 0 && <div className="admin-workflow-pane">
              <p className="admin-modal__body">每个班级创建一个独立账号，用户名按“前缀 + 年级序号 + 班级序号”生成。</p>
            <div className="user-editor__grid">
              <label className="admin-label">
                账号前缀
                <input
                  className="admin-input"
                  value={batchUserDraft.prefix}
                  onChange={(event) => {
                    setBatchUserError("");
                    setBatchUserDraft(
                      (value) =>
                        value && { ...value, prefix: event.target.value },
                    );
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
                    setBatchUserError("");
                    setBatchUserDraft(
                      (value) =>
                        value && { ...value, password: event.target.value },
                    );
                  }}
                  placeholder="至少 8 位，首次登录后必须修改"
                />
              </label>
            </div>
            </div>}
            {batchUserWizardStep === 1 && <div className="admin-workflow-pane">
            <div className="admin-label">
              创建账号的班级
              <ClassMultiPicker
                options={classPickerOptions}
                selectedIds={batchUserDraft.classIds}
                onChange={(ids) => {
                  setBatchUserError("");
                  setBatchUserDraft(
                    (value) => value && { ...value, classIds: ids },
                  );
                }}
              />
            </div>
            <p className="admin-major-card__hint">
              示例：class_admin_g1c01。若用户名已存在，已成功创建的账号会保留，并明确提示停止位置。
            </p>
            </div>}
            {batchUserWizardStep === 2 && <div className="admin-workflow-pane">
              <div className="admin-workflow-review">
                <span>账号前缀<strong>{batchUserDraft.prefix}</strong></span>
                <span>目标班级<strong>{batchUserDraft.classIds.length} 个班级</strong></span>
                <span>初始密码<strong>{batchUserDraft.password.length >= 8 ? "已设置，创建后必须修改" : "长度不足 8 位"}</strong></span>
                <span>结果导出<strong>创建完成后可立即导出 CSV</strong></span>
              </div>
            </div>}
              </div>
            </div>
            {batchUserError && <div className="admin-error">{batchUserError}</div>}
            <div className="admin-modal__actions">
              <button
                className="admin-btn"
                disabled={busy}
                onClick={batchUserWizardStep === 0 ? () => setBatchUserDraft(null) : () => setBatchUserWizardStep((value) => value - 1)}
              >
                {batchUserWizardStep === 0 ? "取消" : "上一步"}
              </button>
              {batchUserWizardStep < 2 ? <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={() => {
                if (batchUserWizardStep === 0 && !batchUserDraft.prefix.trim()) {
                  setBatchUserError("请填写账号前缀。");
                  return;
                }
                if (batchUserWizardStep === 0 && batchUserDraft.password.length < 8) {
                  setBatchUserError("初始密码至少需要 8 位。");
                  return;
                }
                if (batchUserWizardStep === 1 && !batchUserDraft.classIds.length) {
                  setBatchUserError("请至少选择一个班级。");
                  return;
                }
                setBatchUserError("");
                setBatchUserWizardStep((value) => value + 1);
              }}>下一步</button> : <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" disabled={busy || !batchUserDraft.classIds.length} onClick={() => void submitBatchUsers()}>{busy ? "正在创建…" : `创建 ${batchUserDraft.classIds.length} 个账号`}</button>}
            </div>
          </div>
        </AdminModalPortal>
      )}
      {batchCredentials && (
        <AdminModalPortal className="admin-modal-overlay">
          <div
            className="admin-modal admin-modal--wide"
            onClick={(event) => event.stopPropagation()}
          >
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
              <button
                className="admin-btn admin-btn--primary"
                onClick={exportBatchCredentials}
              >
                导出 CSV
              </button>
              <button
                className="admin-btn"
                onClick={() => setBatchCredentials(null)}
              >
                我已妥善保存
              </button>
            </div>
          </div>
        </AdminModalPortal>
      )}
      <div className="device-status__heading user-management__heading">
        <div>
          <h2>{canReadUsers ? "用户与权限" : "我的账户"}</h2>
          <p>
            {canReadUsers
              ? "为不同管理员分配可编辑内容和年级、班级范围。所有限制均由服务端再次校验。"
              : "管理当前账号的登录用户名和密码。"}
          </p>
        </div>
        <div className="user-management__heading-actions">
          <button
            className="admin-btn"
            onClick={() => {
              setUsernameDraft({
                currentPassword: "",
                username: current?.username ?? "",
              });
              setUsernameOpen(true);
            }}
          >
            修改用户名
          </button>
          <button className="admin-btn" onClick={() => setPasswordOpen(true)}>
            修改密码
          </button>
          {section === "users" && canCreateUser && (
            <>
              <button
                className="admin-btn"
                onClick={() => {
                  setBatchUserError("");
                  setBatchUserDraft({
                    prefix: "class_admin",
                    password: "",
                    classIds: [],
                  });
                }}
              >
                批量添加班级管理员
              </button>
              <button
                className="admin-btn admin-btn--primary"
                onClick={beginCreateUser}
              >
                添加用户
              </button>
            </>
          )}


        </div>
      </div>
      <AccountEmailBinding />
      {current?.mustChangePassword && (
        <div className="admin-info-banner admin-info-banner--warn">
          当前使用的是初始账户信息。请先设置自己的用户名和新密码，完成后重新登录。
        </div>
      )}
      {canReadUsers && (
        <div className="user-management__tabs">
          <button
            className={section === "users" ? "is-active" : ""}
            onClick={() => setSection("users")}
          >
            管理员
          </button>
          {canManageRoles && (
            <button
              className={section === "roles" ? "is-active" : ""}
              onClick={() => setSection("roles")}
            >
              角色权限
            </button>
          )}
          {canReadAudit && (
            <button
              className={section === "audit" ? "is-active" : ""}
              onClick={() => setSection("audit")}
            >
              操作日志
            </button>
          )}
        </div>
      )}
      {message && (
        <div className="admin-info-banner" aria-live="polite">
          {message}
        </div>
      )}
      {loading ? (
        <div className="admin-loading">正在读取用户权限…</div>
      ) : !canReadUsers ? (
        <section className="user-management__account-card">
          <span>当前账号</span>
          <strong>{current?.displayName}</strong>
          <code>@{current?.username}</code>
          <small>{current?.roleName}</small>
        </section>
      ) : section === "users" ? (
        <>
          <div className="device-status__stats">
            <div>
              <span>管理员总数</span>
              <strong>{users.length}</strong>
            </div>
            <div>
              <span>当前启用</span>
              <strong>
                {users.filter((user) => user.status === "active").length}
              </strong>
            </div>
            <div>
              <span>自定义角色</span>
              <strong>{roles.filter((role) => !role.builtIn).length}</strong>
            </div>
            <div>
              <span>需修改密码</span>
              <strong>
                {users.filter((user) => user.mustChangePassword).length}
              </strong>
            </div>
          </div>
                    {canDeleteUser && (
            <div className="user-management__batch-entry">
              {batchDeleteMode && (
                <InlineSelect
                  className="admin-input user-management__batch-grade-filter"
                  value={batchDeleteGradeId}
                  onChange={(value) => {
                    setBatchDeleteGradeId(value);
                    setSelectedUserIds([]);
                  }}
                  options={[
                    { value: "", label: "全部年级" },
                    ...visibleGrades.map((grade) => ({
                      value: grade.id,
                      label: grade.name,
                    })),
                  ]}
                />
              )}
              <button
                className={`admin-btn${batchDeleteMode ? " admin-btn--danger" : ""}`}
                onClick={() => {
                  setBatchDeleteMode((value) => !value);
                  setSelectedUserIds([]);
                  setBatchDeleteGradeId("");
                }}
              >
                {batchDeleteMode ? "退出批量删除" : "批量删除账户"}
              </button>
              {batchDeleteMode && (
                <span className="user-management__batch-entry-count">
                  已选择 {selectedUserIds.length} 个账号
                </span>
              )}
              {batchDeleteMode && (
                <button
                  className="admin-btn admin-btn--danger"
                  disabled={busy || !selectedUserIds.length}
                  onClick={() => void removeSelectedUsers()}
                >
                  删除所选账号
                </button>
              )}
            </div>
          )}
          {!batchDeleteMode && (
            <div className="user-management__toolbar">
              <input
                className="admin-input"
                placeholder="搜索姓名或用户名…"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              <InlineSelect
                className="admin-input"
                value={roleFilter}
                onChange={setRoleFilter}
                options={[
                  { value: "", label: "全部角色" },
                  ...roles.map((role) => ({ value: role.id, label: role.name })),
                ]}
              />
              <InlineSelect
                className="admin-input"
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: "", label: "全部状态" },
                  { value: "active", label: "已启用" },
                  { value: "disabled", label: "已停用" },
                ]}
              />
              <span className="user-management__toolbar-count">
                共 {filteredUsers.length} 个账号
              </span>
            </div>
          )}
          <div className="user-management__groups">
            {userGroups.map((group) => {
              const expanded = !collapsedGroups[group.key];
              const allSelected =
                group.users.length > 0 &&
                group.users.every((user) => selectedUserIds.includes(user.id));
              return (
                <section className="user-management__group" key={group.key}>
                  <div className="user-management__group-head">
                    <button
                      type="button"
                      className="user-management__group-toggle"
                      aria-expanded={expanded}
                      onClick={() =>
                        setCollapsedGroups((prev) => ({
                          ...prev,
                          [group.key]: !prev[group.key],
                        }))
                      }
                    >
                      <span
                        className="user-management__group-caret"
                        aria-hidden="true"
                      />
                      <strong>{group.name}</strong>
                      {group.builtIn && (
                        <span className="user-management__group-badge">内置</span>
                      )}
                      <span className="user-management__group-count">
                        {group.users.length} 人
                      </span>
                    </button>
                    {batchDeleteMode && group.users.length > 0 && (
                      <label className="user-management__group-select">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={(event) =>
                            setSelectedUserIds((ids) =>
                              event.target.checked
                                ? [
                                    ...new Set([
                                      ...ids,
                                      ...group.users.map((user) => user.id),
                                    ]),
                                  ]
                                : ids.filter(
                                    (id) =>
                                      !group.users.some((user) => user.id === id),
                                  ),
                            )
                          }
                        />
                        全选本组
                      </label>
                    )}
                  </div>
                  {expanded && (
                    <div className="user-management__group-body">
                      {group.users.length === 0 ? (
                        <div className="user-management__group-empty">
                          该角色暂无账号
                        </div>
                      ) : (
                        group.users.map((user) => (
                          <article
                            className={`user-management__row${user.status === "disabled" ? " is-disabled" : ""}${batchDeleteMode ? " is-batch" : ""}`}
                            key={user.id}
                          >
                            {batchDeleteMode && user.id !== current?.id && (
                              <input
                                className="user-management__batch-check"
                                type="checkbox"
                                checked={selectedUserIds.includes(user.id)}
                                onChange={(event) =>
                                  setSelectedUserIds((ids) =>
                                    event.target.checked
                                      ? [...ids, user.id]
                                      : ids.filter((id) => id !== user.id),
                                  )
                                }
                                aria-label={"选择 " + user.displayName}
                              />
                            )}
                            <div className="user-management__identity">
                              <strong>
                                {user.displayName}
                                {user.id === current?.id && (
                                  <span className="user-management__self">
                                    当前账号
                                  </span>
                                )}
                                {user.mustChangePassword && (
                                  <span className="user-management__password-badge">
                                    首次登录需改密码
                                  </span>
                                )}
                              </strong>
                              <code>@{user.username}</code>
                            </div>
                            <div
                              className="user-management__scope-cell"
                              title={scopeText(user, grades, classes)}
                            >
                              <span className="user-management__role">
                                {user.roleName}
                              </span>
                              <small>{scopeText(user, grades, classes)}</small>
                            </div>
                            <div
                              className="user-management__status-cell"
                              title={"最近登录：" + fmt(user.lastLoginAt)}
                            >
                              <small>
                                <i
                                  className={
                                    "user-management__status-dot" +
                                    (user.status === "active"
                                      ? " is-active"
                                      : " is-disabled")
                                  }
                                  aria-hidden="true"
                                />
                                {user.status === "active" ? "已启用" : "已停用"}
                              </small>
                            </div>
                            {(canEditUser ||
                              canResetPassword ||
                              canDeleteUser) && (
                              <div className="user-management__actions">
                                {canEditUser && (
                                  <button
                                    className="admin-btn"
                                    onClick={() => beginEditUser(user)}
                                  >
                                    编辑
                                  </button>
                                )}
                                {(canResetPassword ||
                                  canDeleteUser ||
                                  user.id === current?.id) && (
                                  <button
                                    type="button"
                                    className="admin-btn user-management__menu-btn"
                                    aria-haspopup="menu"
                                    aria-expanded={menuUser === String(user.id)}
                                    onClick={(event) => toggleMenu(event, user)}
                                  >
                                    ⋯
                                  </button>
                                )}
                              </div>
                            )}
                          </article>
                        ))
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      ) : section === "roles" ? (
        <div className="user-management__role-layout">
          <aside className="user-management__role-list">
            {canManageRoles && (
              <button
                className="admin-btn admin-btn--primary user-management__new-role"
                onClick={() => {
                  setRoleError("");
                  setRoleDraft({ name: "", description: "", permissions: [] });
                }}
              >
                新建角色
              </button>
            )}
            {roles.map((role) => (
              <button
                type="button"
                key={role.id}
                className={
                  "user-management__role-item" +
                  (selectedRoleId === role.id ? " is-active" : "")
                }
                aria-pressed={selectedRoleId === role.id}
                onClick={() => selectRole(role)}
              >
                <span className="user-management__role-item-main">
                  <strong>{role.name}</strong>
                  {role.builtIn && <em>内置</em>}
                </span>
                <small>
                  {role.permissions.includes("*")
                    ? "全部权限"
                    : role.permissions.length + " 项权限"}
                </small>
              </button>
            ))}
          </aside>
          <section className="user-management__role-panel">
            {selectedRole ?
              (() => {
                const permissionGroups = rolePermissionGroups(
                  selectedRole,
                  matrixDraft,
                );
                const draft =
                  matrixDraft && matrixDraft.id === selectedRole.id
                    ? matrixDraft
                    : null;
                const shownPermissions = draft
                  ? draft.permissions
                  : selectedRole.permissions;
                return (
                  <>
                    <div className="user-management__role-panel-head">
                      <div>
                        <strong>{selectedRole.name}</strong>
                        {selectedRole.builtIn && <span>内置</span>}
                      </div>
                      <small>
                        {shownPermissions.includes("*")
                          ? "全部权限"
                          : shownPermissions.length + " 项权限"}
                      </small>
                    </div>
                    <p className="user-management__role-panel-desc">
                      {selectedRole.description || "尚未填写角色职责说明。"}
                    </p>
                    <div className="user-management__matrix">
                      <div className="user-management__matrix-row user-management__matrix-head">
                        <span>模块</span>
                        <span>不可访问</span>
                        <span>仅查看</span>
                        <span>可管理</span>
                      </div>
                      {ROLE_MODULES.map((module) => {
                        const level = moduleLevel(shownPermissions, module);
                        const canManage = module.manage.length > 0;
                        const readonly = selectedRole.builtIn || !draft;
                        return (
                          <div className="user-management__matrix-row" key={module.id}>
                            <span className="user-management__matrix-module">
                              <strong>{module.label}</strong>
                              <small>
                                {canManage ? "查看或管理整个模块" : "仅控制显示"}
                              </small>
                            </span>
                            {(["none", "read", "manage"] as const).map(
                              (levelKey) => {
                                const disabled =
                                  readonly ||
                                  (!canManage && levelKey === "manage");
                                return (
                                  <button
                                    type="button"
                                    key={levelKey}
                                    className={
                                      "user-management__matrix-cell" +
                                      (level === levelKey ? " is-active" : "") +
                                      (disabled ? " is-disabled" : "")
                                    }
                                    disabled={disabled}
                                    onClick={() => {
                                      if (draft) {
                                        setMatrixModuleLevel(module, levelKey);
                                      }
                                    }}
                                  >
                                    {levelKey === "none"
                                      ? "—"
                                      : levelKey === "read"
                                        ? "查看"
                                        : "管理"}
                                  </button>
                                );
                              },
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {!selectedRole.builtIn && (
                      <div className="user-management__matrix-actions">
                        <button
                          className="admin-btn admin-btn--primary"
                          disabled={busy || !draft}
                          onClick={() => void saveMatrixRole()}
                        >
                          {busy ? "保存中…" : "保存角色"}
                        </button>
                        <button
                          className="admin-btn"
                          disabled={busy}
                          onClick={() => setMatrixDraft(null)}
                        >
                          放弃修改
                        </button>
                      </div>
                    )}
                    {permissionGroups.length > 0 && (
                      <details className="user-management__role-detail">
                        <summary>
                          {shownPermissions.includes("*")
                            ? "查看全部系统权限说明"
                            : "查看 " + shownPermissions.length + " 项权限明细"}
                        </summary>
                        <div className="user-management__role-groups">
                          {permissionGroups.map((group) => (
                            <section key={group.prefix}>
                              <b>{group.label}</b>
                              <ul>
                                {group.items.map((permission) => (
                                  <li key={permission}>
                                    <strong>
                                      {permissionMeta(permission).label}
                                    </strong>
                                    <span>
                                      {permissionMeta(permission).description}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </section>
                          ))}
                        </div>
                      </details>
                    )}
                  </>
                );
              })()
            : (
              <div className="admin-empty">
                <Mascot className="mascot-empty" size={64} alt="" />
                <p>请选择一个角色查看权限</p>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="user-management__audit">
          {logs.length ? (
            logs.map((log) => (
              <div className="user-management__audit-row" key={log.id}>
                <time>{fmt(log.createdAt)}</time>
                <strong>{log.username || "系统"}</strong>
                <span>{ACTION_LABEL[log.action] || log.action}</span>
                <code>{log.resourceId || log.resourceType}</code>
              </div>
            ))
          ) : (
            <div className="admin-empty">
              <Mascot className="mascot-empty" size={64} alt="" />
              <p>暂无操作记录</p>
            </div>
          )}
        </div>
      )}

      {menuUser && menuRect && (() => {
        const target =
          users.find((user) => String(user.id) === menuUser) ?? null;
        if (!target) return null;
        const itemCount =
          (canResetPassword && target.id !== current?.id ? 1 : 0) +
          (canDeleteUser && target.id !== current?.id ? 1 : 0) +
          (target.id === current?.id ? 1 : 0);
        const menuWidth = 148;
        const menuHeight = itemCount * 34 + 14;
        const left = Math.min(
          Math.max(menuRect.left - menuWidth, 8),
          window.innerWidth - menuWidth - 8,
        );
        const openUp =
          menuRect.top + 8 + menuHeight > window.innerHeight;
        const top = openUp
          ? Math.max(menuRect.top - menuHeight - 6, 8)
          : menuRect.top + 6;
        return (
          <AdminModalPortal className="user-management__menu-layer">
            <button
              type="button"
              className="user-management__menu-backdrop"
              aria-label="关闭菜单"
              onClick={() => {
                setMenuUser(null);
                setMenuRect(null);
              }}
            />
            <div
              className="user-management__menu"
              role="menu"
              style={{ left, top }}
            >
              {canResetPassword && target.id !== current?.id && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuUser(null);
                    setMenuRect(null);
                    setResetTarget(target);
                    setResetMode("generated");
                    setResetPassword(generateTemporaryPassword());
                    setResetError("");
                  }}
                >
                  重置密码
                </button>
              )}
              {canDeleteUser && target.id !== current?.id && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuUser(null);
                    setMenuRect(null);
                    void removeUser(target);
                  }}
                >
                  删除
                </button>
              )}
              {target.id === current?.id && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuUser(null);
                    setMenuRect(null);
                    setPasswordOpen(true);
                  }}
                >
                  修改密码
                </button>
              )}
            </div>
          </AdminModalPortal>
        );
      })()}
      {userDraft && (
        <AdminModalPortal className="admin-modal-overlay">
          <div
            className="admin-modal admin-modal--wide admin-modal--workflow"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="admin-modal__title admin-workflow-head">
              {userDraft.id ? "编辑管理员" : "添加管理员"}
            </h2>
            <AdminWorkflowClose onClick={() => { setUserDraft(null); setUserErrors({}); }} />
            <div className="admin-workflow-layout">
              <AdminWizardSteps
                active={userWizardStep}
                steps={[
                  { label: "账户信息", hint: "用户名、名称和角色" },
                  { label: "管理范围", hint: "年级与班级权限" },
                  { label: "确认保存", hint: "检查账户配置" },
                ]}
                summary={<><span>当前账户</span><strong>{userDraft.displayName || userDraft.username || "尚未填写"}</strong><span>{delegableRoles.find((role) => role.id === userDraft.roleId)?.name || "尚未选择角色"}</span></>}
              />
              <div className="admin-workflow-content" key={userWizardStep}>
            {userWizardStep === 0 && <div className="admin-workflow-pane">
            <div className="user-editor__grid">
              <label className="admin-label">
                用户名
                <input
                  className="admin-input"
                  disabled={!!userDraft.id}
                  value={userDraft.username}
                  onChange={(event) => {
                    setUserErrors((value) => ({ ...value, username: "" }));
                    setUserDraft(
                      (value) =>
                        value && { ...value, username: event.target.value },
                    );
                  }}
                  placeholder="如：grade3_admin"
                />
                {userErrors.username && (
                  <small className="admin-field-error">
                    {userErrors.username}
                  </small>
                )}
              </label>
              <label className="admin-label">
                显示名称
                <input
                  className="admin-input"
                  value={userDraft.displayName}
                  onChange={(event) => {
                    setUserErrors((value) => ({ ...value, displayName: "" }));
                    setUserDraft(
                      (value) =>
                        value && { ...value, displayName: event.target.value },
                    );
                  }}
                  placeholder="如：高三教务"
                />
                {userErrors.displayName && (
                  <small className="admin-field-error">
                    {userErrors.displayName}
                  </small>
                )}
              </label>
              {!userDraft.id && (
                <label className="admin-label">
                  初始密码
                  <input
                    className="admin-input"
                    type="password"
                    value={userDraft.password}
                    onChange={(event) => {
                      setUserErrors((value) => ({ ...value, password: "" }));
                      setUserDraft(
                        (value) =>
                          value && { ...value, password: event.target.value },
                      );
                    }}
                    placeholder="至少 8 位"
                  />
                  {userErrors.password && (
                    <small className="admin-field-error">
                      {userErrors.password}
                    </small>
                  )}
                </label>
              )}
              <label className="admin-label">
                角色
                <InlineSelect
                  className="admin-input"
                  value={userDraft.roleId}
                  onChange={(roleId) => {
                    setUserErrors((value) => ({ ...value, roleId: "", scopes: "" }));
                    setUserDraft(
                      (value) =>
                        value && {
                          ...value,
                          roleId,
                          gradeIds:
                            roleId === "class_admin" ? [] : value.gradeIds,
                          classIds:
                            roleId === "grade_admin" ? [] : value.classIds,
                        },
                    );
                  }}
                  options={delegableRoles.map((role) => ({ value: role.id, label: role.name }))}
                />
                {userErrors.roleId && (
                  <small className="admin-field-error">
                    {userErrors.roleId}
                  </small>
                )}
              </label>
              {userDraft.id && (
                <label className="admin-label">
                  状态
                  <InlineSelect
                    className="admin-input"
                    value={userDraft.status}
                    onChange={(status) =>
                      setUserDraft(
                        (value) =>
                          value && {
                            ...value,
                            status: status as UserDraft["status"],
                          },
                      )
                    }
                    options={[{ value: 'active', label: '启用' }, { value: 'disabled', label: '停用' }]}
                  />
                </label>
              )}
            </div>
            </div>}
            {userWizardStep === 1 && <div className="admin-workflow-pane">
            <div className="user-editor__scope">
              {canAssignAll && (
                <label className="admin-toggle-label">
                  <input
                    type="checkbox"
                    checked={
                      userDraft.allScope || userDraft.roleId === "super_admin"
                    }
                    disabled={userDraft.roleId === "super_admin"}
                    onChange={(event) =>
                      setUserDraft(
                        (value) =>
                          value && { ...value, allScope: event.target.checked },
                      )
                    }
                  />
                  管理全校数据
                </label>
              )}
              {!userDraft.allScope && userDraft.roleId !== "super_admin" && (
                <>
                  {userDraft.roleId !== "class_admin" && (
                    <>
                      <h3>可管理年级</h3>
                      <div className="admin-major-targets">
                        {visibleGrades.map((grade) => (
                          <label key={grade.id}>
                            <input
                              type="checkbox"
                              checked={userDraft.gradeIds.includes(grade.id)}
                              onChange={(event) => {
                                setUserErrors((value) => ({
                                  ...value,
                                  scopes: "",
                                }));
                                setUserDraft(
                                  (value) =>
                                    value && {
                                      ...value,
                                      gradeIds: event.target.checked
                                        ? [...value.gradeIds, grade.id]
                                        : value.gradeIds.filter(
                                            (id) => id !== grade.id,
                                          ),
                                    },
                                );
                              }}
                            />
                            {grade.name}
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                  <h3>{userDraft.roleId === "class_admin" ? "指定管理班级" : "额外指定班级"}</h3>
                  <ClassMultiPicker
                    options={classPickerOptions}
                    selectedIds={userDraft.classIds}
                    onChange={(ids) => {
                      setUserErrors((value) => ({ ...value, scopes: "" }));
                      setUserDraft(
                        (value) => value && { ...value, classIds: ids },
                      );
                    }}
                  />
                  {userErrors.scopes && (
                    <small className="admin-field-error">
                      {userErrors.scopes}
                    </small>
                  )}
                </>
              )}
            </div>
            </div>}
            {userWizardStep === 2 && <div className="admin-workflow-pane">
              <div className="admin-workflow-review">
                <span>登录用户名<strong>{userDraft.username}</strong></span>
                <span>显示名称<strong>{userDraft.displayName}</strong></span>
                <span>账户角色<strong>{delegableRoles.find((role) => role.id === userDraft.roleId)?.name || userDraft.roleId}</strong></span>
                <span>管理年级<strong>{userDraft.allScope || userDraft.roleId === "super_admin" ? "全校" : userDraft.roleId === "class_admin" ? `${new Set(userDraft.classIds.map((classId) => classes.find((item) => item.id === classId)?.gradeId).filter(Boolean)).size} 个年级` : `${userDraft.gradeIds.length} 个年级`}</strong></span>
                <span>{userDraft.roleId === "class_admin" ? "管理班级" : "额外班级"}<strong>{userDraft.allScope || userDraft.roleId === "super_admin" ? "无需单独指定" : `${userDraft.classIds.length} 个班级`}</strong></span>
                {userDraft.id && <span>账户状态<strong>{userDraft.status === "active" ? "启用" : "停用"}</strong></span>}
              </div>
              {userErrors.scopes && (
                <small className="admin-field-error">
                  {userErrors.scopes}
                </small>
              )}
            </div>}
              </div>
            </div>
            <div className="admin-modal__actions">
              <button
                className="admin-btn"
                onClick={userWizardStep === 0 ? () => { setUserDraft(null); setUserErrors({}); } : () => setUserWizardStep((value) => value - 1)}
              >
                {userWizardStep === 0 ? "取消" : "上一步"}
              </button>
              {userWizardStep < 2 ? <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={() => {
                if (userWizardStep === 0) {
                  const stepErrors = validateUserDraftFields(userDraft);
                  if (Object.keys(stepErrors).length) {
                    setUserErrors((value) => ({ ...value, ...stepErrors }));
                    return;
                  }
                }
                if (userWizardStep === 1) {
                  const scopeError = validateUserScopes(userDraft);
                  if (scopeError) {
                    setUserErrors((value) => ({ ...value, scopes: scopeError }));
                    return;
                  }
                }
                setUserWizardStep((value) => value + 1);
              }}>下一步</button> : <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" disabled={busy} onClick={() => void submitUser()}>{busy ? "保存中…" : "保存管理员"}</button>}
            </div>
          </div>
        </AdminModalPortal>
      )}
      {roleDraft && (
        <AdminModalPortal className="admin-modal-overlay">
          <div
            className="admin-modal admin-modal--wide admin-modal--workflow"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="admin-modal__title admin-workflow-head">
              {roleDraft.id ? "编辑自定义角色" : "新建自定义角色"}
            </h2>
            <AdminWorkflowClose onClick={() => setRoleDraft(null)} />
            <div className="admin-workflow-layout">
              <AdminWizardSteps
                active={roleWizardStep}
                steps={[
                  { label: "角色信息", hint: "名称和职责说明" },
                  { label: "模块权限", hint: "按模块选择权限级别" },
                  { label: "确认保存", hint: "检查角色能力" },
                ]}
                summary={<><span>当前角色</span><strong>{roleDraft.name || "尚未命名"}</strong><span>{ROLE_MODULES.filter((module) => moduleLevel(roleDraft.permissions, module) !== "none").length} 个可访问模块</span></>}
              />
              <div className="admin-workflow-content" key={roleWizardStep}>
            {roleWizardStep === 0 && <div className="admin-workflow-pane">
            <label className="admin-label">
              角色名称
              <input
                className="admin-input"
                value={roleDraft.name}
                onChange={(event) =>
                  setRoleDraft(
                    (value) => value && { ...value, name: event.target.value },
                  )
                }
              />
            </label>
            <label className="admin-label">
              角色职责说明
              <textarea
                className="admin-textarea"
                rows={2}
                value={roleDraft.description}
                onChange={(event) =>
                  setRoleDraft(
                    (value) =>
                      value && { ...value, description: event.target.value },
                  )
                }
                placeholder="说明该角色负责什么、不能做什么，分配账号时会直接展示。"
              />
            </label>
            </div>}
            {roleWizardStep === 1 && <div className="admin-workflow-pane">
            <div className="role-editor__modules">
              {ROLE_MODULES.map((module) => (
                <label key={module.id}>
                  <span>
                    <strong>{module.label}</strong>
                    <small>
                      {module.manage.length
                        ? "选择查看或管理整个模块"
                        : "控制是否显示该模块"}
                    </small>
                  </span>
                  <InlineSelect
                    className="admin-input"
                    value={moduleLevel(roleDraft.permissions, module)}
                    onChange={(value) =>
                      setRoleModuleLevel(
                        module,
                        value as RoleLevel,
                      )
                    }
                    options={[{ value: 'none', label: '不可访问' }, { value: 'read', label: '仅查看' }, ...(module.manage.length > 0 ? [{ value: 'manage', label: '可管理' }] : [])]}
                  />
                </label>
              ))}
            </div>
            <p className="admin-major-card__hint">
              数据库重置、初始化、角色管理、部署和超级管理员操作仅保留给超级管理员。
            </p>
            </div>}
            {roleWizardStep === 2 && <div className="admin-workflow-pane">
              <div className="admin-workflow-review">
                <span>角色名称<strong>{roleDraft.name || "未填写"}</strong></span>
                <span>职责说明<strong>{roleDraft.description || "未填写"}</strong></span>
                {ROLE_MODULES.map((module) => <span key={module.id}>{module.label}<strong>{moduleLevel(roleDraft.permissions, module) === "manage" ? "可管理" : moduleLevel(roleDraft.permissions, module) === "read" ? "仅查看" : "不可访问"}</strong></span>)}
              </div>
            </div>}
              </div>
            </div>
            {roleError && <div className="admin-error">{roleError}</div>}
            <div className="admin-modal__actions">
              <button
                className="admin-btn"
                onClick={roleWizardStep === 0 ? () => setRoleDraft(null) : () => setRoleWizardStep((value) => value - 1)}
              >
                {roleWizardStep === 0 ? "取消" : "上一步"}
              </button>
              {roleWizardStep < 2 ? <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={() => {
                if (roleWizardStep === 0 && !roleDraft.name.trim()) {
                  setRoleError("请填写角色名称。");
                  return;
                }
                if (roleWizardStep === 1 && !roleDraft.permissions.length) {
                  setRoleError("请至少选择一项权限。");
                  return;
                }
                setRoleError("");
                setRoleWizardStep((value) => value + 1);
              }}>下一步</button> : <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" disabled={busy} onClick={() => void submitRole()}>{busy ? "保存中…" : "保存角色"}</button>}
            </div>
          </div>
        </AdminModalPortal>
      )}
      {resetTarget && (
        <AdminModalPortal className="admin-modal-overlay">
          <div
            className="admin-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="admin-modal__title">
              重置 {resetTarget.displayName} 的密码
            </h2>
            <p className="admin-modal__body">
              重置后该用户当前登录立即失效，下次登录必须再次修改用户名和密码。
            </p>
            <div className="user-management__reset-modes">
              <button
                className={resetMode === "generated" ? "is-active" : ""}
                onClick={() => {
                  setResetMode("generated");
                  setResetPassword(generateTemporaryPassword());
                  setResetError("");
                }}
              >
                自动生成临时密码
              </button>
              <button
                className={resetMode === "manual" ? "is-active" : ""}
                onClick={() => {
                  setResetMode("manual");
                  setResetPassword("");
                  setResetError("");
                }}
              >
                手动设置
              </button>
            </div>
            {resetError && <div className="admin-error">{resetError}</div>}
            <label className="admin-label">
              临时密码
              <input
                className="admin-input"
                type={resetMode === "manual" ? "password" : "text"}
                value={resetPassword}
                onChange={(event) => {
                  setResetPassword(event.target.value);
                  setResetError("");
                }}
                placeholder="新密码，至少 8 位"
              />
            </label>
            {resetMode === "generated" && (
              <button
                className="admin-btn user-management__regenerate"
                onClick={() => setResetPassword(generateTemporaryPassword())}
              >
                重新生成
              </button>
            )}
            <div className="admin-modal__actions">
              <button
                className="admin-btn admin-btn--primary"
                disabled={busy}
                onClick={() => void submitReset()}
              >
                {busy ? "正在重置…" : "确认重置"}
              </button>
              <button
                className="admin-btn"
                onClick={() => {
                  setResetTarget(null);
                  setResetPassword("");
                  setResetError("");
                }}
              >
                取消
              </button>
            </div>
          </div>
        </AdminModalPortal>
      )}
      {issuedPassword && (
        <AdminModalPortal className="admin-modal-overlay">
          <div
            className="admin-modal"
            onClick={(event) => event.stopPropagation()}
          >
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
                    await navigator.clipboard.writeText(
                      issuedPassword.password,
                    );
                    setCopyStatus("已复制");
                  } catch {
                    setCopyStatus("复制失败，请手动复制");
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
                  setCopyStatus("");
                }}
              >
                我已妥善保存
              </button>
            </div>
          </div>
        </AdminModalPortal>
      )}
      {passwordOpen && (
        <AdminModalPortal className="admin-modal-overlay">
          <div
            className="admin-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="admin-modal__title">
              {forcePasswordChange || current?.mustChangePassword
                ? "设置我的账户信息"
                : "修改我的密码"}
            </h2>
            <p className="admin-modal__body">
              账户信息保存在当前部署的 Neon
              数据库。修改成功后所有旧会话会失效，需要使用新用户名和密码重新登录。
            </p>
            <div className="user-management__password-fields">
              {(forcePasswordChange || current?.mustChangePassword) && (
                <label className="admin-label">
                  新登录用户名
                  <input
                    className="admin-input"
                    autoComplete="username"
                    value={passwordDraft.username}
                    onChange={(event) => {
                      setPasswordErrors((value) => ({
                        ...value,
                        username: "",
                      }));
                      setPasswordDraft((value) => ({
                        ...value,
                        username: event.target.value,
                      }));
                    }}
                    placeholder="3-40 位字母、数字、点、横线或下划线"
                  />
                  {passwordErrors.username && (
                    <small className="admin-field-error">
                      {passwordErrors.username}
                    </small>
                  )}
                </label>
              )}
              <label className="admin-label">
                当前密码
                <input
                  className="admin-input"
                  type="password"
                  autoComplete="current-password"
                  value={passwordDraft.current}
                  onChange={(event) => {
                    setPasswordErrors((value) => ({ ...value, current: "" }));
                    setPasswordDraft((value) => ({
                      ...value,
                      current: event.target.value,
                    }));
                  }}
                />
                {passwordErrors.current && (
                  <small className="admin-field-error">
                    {passwordErrors.current}
                  </small>
                )}
              </label>
              <label className="admin-label">
                新密码
                <input
                  className="admin-input"
                  type="password"
                  autoComplete="new-password"
                  value={passwordDraft.next}
                  onChange={(event) => {
                    setPasswordErrors((value) => ({ ...value, next: "" }));
                    setPasswordDraft((value) => ({
                      ...value,
                      next: event.target.value,
                    }));
                  }}
                  placeholder="至少 8 位"
                />
                {passwordErrors.next && (
                  <small className="admin-field-error">
                    {passwordErrors.next}
                  </small>
                )}
              </label>
              <label className="admin-label">
                确认新密码
                <input
                  className="admin-input"
                  type="password"
                  autoComplete="new-password"
                  value={passwordDraft.confirm}
                  onChange={(event) => {
                    setPasswordErrors((value) => ({ ...value, confirm: "" }));
                    setPasswordDraft((value) => ({
                      ...value,
                      confirm: event.target.value,
                    }));
                  }}
                />
                {passwordErrors.confirm && (
                  <small className="admin-field-error">
                    {passwordErrors.confirm}
                  </small>
                )}
              </label>
            </div>
            <div className="admin-modal__actions">
              <button
                className="admin-btn admin-btn--primary"
                disabled={busy}
                onClick={() => void submitOwnPassword()}
              >
                {busy ? "保存中…" : "保存并重新登录"}
              </button>
              {!forcePasswordChange && !current?.mustChangePassword && (
                <button
                  className="admin-btn"
                  onClick={() => {
                    setPasswordOpen(false);
                    setPasswordErrors({});
                  }}
                >
                  取消
                </button>
              )}
            </div>
          </div>
        </AdminModalPortal>
      )}
      {usernameOpen && (
        <AdminModalPortal className="admin-modal-overlay">
          <div
            className="admin-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="admin-modal__title">修改我的用户名</h2>
            <p className="admin-modal__body">
              修改后所有旧会话都会失效，需要使用新用户名重新登录。
            </p>
            {usernameError && (
              <div className="admin-error">{usernameError}</div>
            )}
            <div className="user-management__password-fields">
              <label className="admin-label">
                新登录用户名
                <input
                  className="admin-input"
                  autoComplete="username"
                  value={usernameDraft.username}
                  onChange={(event) => {
                    setUsernameError("");
                    setUsernameDraft((value) => ({
                      ...value,
                      username: event.target.value,
                    }));
                  }}
                />
              </label>
              <label className="admin-label">
                验证当前身份
                <input
                  className="admin-input"
                  type="password"
                  autoComplete="current-password"
                  value={usernameDraft.currentPassword}
                  onChange={(event) => {
                    setUsernameError("");
                    setUsernameDraft((value) => ({
                      ...value,
                      currentPassword: event.target.value,
                    }));
                  }}
                  placeholder="请输入当前登录密码"
                />
                <small className="admin-field-hint">
                  仅用于验证操作者身份，不会修改当前密码。
                </small>
              </label>
            </div>
            <div className="admin-modal__actions">
              <button
                className="admin-btn admin-btn--primary"
                disabled={busy}
                onClick={() => void submitOwnUsername()}
              >
                {busy ? "验证中…" : "验证并修改用户名"}
              </button>
              <button
                className="admin-btn"
                onClick={() => {
                  setUsernameOpen(false);
                  setUsernameError("");
                }}
              >
                取消
              </button>
            </div>
          </div>
        </AdminModalPortal>
      )}
    </main>
  );
}
