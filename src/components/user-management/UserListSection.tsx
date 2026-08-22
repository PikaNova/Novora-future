import React from 'react';
import InlineSelect from '../InlineSelect';
import { fmt, scopeText } from './helpers';
import type { ManagedUser, ManagedRole } from '../../services/adminUsers';
import type { AdminUserContext } from '../../services/examService';
import type { SchoolClass, SchoolGrade } from '../../types/school';

export type UserGroup = { key: string; name: string; builtIn: boolean; users: ManagedUser[] };

export interface UserListSectionProps {
  users: ManagedUser[];
  roles: ManagedRole[];
  grades: SchoolGrade[];
  classes: SchoolClass[];
  visibleGrades: SchoolGrade[];
  current: AdminUserContext | null;
  busy: boolean;
  canEditUser: boolean;
  canDeleteUser: boolean;
  canResetPassword: boolean;
  searchQuery: string;
  roleFilter: string;
  statusFilter: string;
  filteredUsers: ManagedUser[];
  userGroups: UserGroup[];
  selectedUserIds: number[];
  batchDeleteMode: boolean;
  batchDeleteGradeId: string;
  collapsedGroups: Record<string, boolean>;
  menuUser: string | null;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setRoleFilter: React.Dispatch<React.SetStateAction<string>>;
  setStatusFilter: React.Dispatch<React.SetStateAction<string>>;
  setSelectedUserIds: React.Dispatch<React.SetStateAction<number[]>>;
  setBatchDeleteMode: React.Dispatch<React.SetStateAction<boolean>>;
  setBatchDeleteGradeId: React.Dispatch<React.SetStateAction<string>>;
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  beginEditUser: (user: ManagedUser) => void;
  removeSelectedUsers: () => Promise<void> | void;
  toggleMenu: (event: React.MouseEvent<HTMLButtonElement>, user: ManagedUser) => boolean | void;
}

export default function UserListSection(props: UserListSectionProps) {
  const {
    users,
    roles,
    grades,
    classes,
    visibleGrades,
    current,
    busy,
    canEditUser,
    canDeleteUser,
    canResetPassword,
    searchQuery,
    roleFilter,
    statusFilter,
    filteredUsers,
    userGroups,
    selectedUserIds,
    batchDeleteMode,
    batchDeleteGradeId,
    collapsedGroups,
    menuUser,
    setSearchQuery,
    setRoleFilter,
    setStatusFilter,
    setSelectedUserIds,
    setBatchDeleteMode,
    setBatchDeleteGradeId,
    setCollapsedGroups,
    beginEditUser,
    removeSelectedUsers,
    toggleMenu,
  } = props;
  return (
    <>
      <div className="device-status__stats">
        <div>
          <span>管理员总数</span>
          <strong>{users.length}</strong>
        </div>
        <div>
          <span>当前启用</span>
          <strong>{users.filter((user) => user.status === 'active').length}</strong>
        </div>
        <div>
          <span>自定义角色</span>
          <strong>{roles.filter((role) => !role.builtIn).length}</strong>
        </div>
        <div>
          <span>需修改密码</span>
          <strong>{users.filter((user) => user.mustChangePassword).length}</strong>
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
                { value: '', label: '全部年级' },
                ...visibleGrades.map((grade) => ({
                  value: grade.id,
                  label: grade.name,
                })),
              ]}
            />
          )}
          <button
            className={`admin-btn${batchDeleteMode ? ' admin-btn--danger' : ''}`}
            onClick={() => {
              setBatchDeleteMode((value) => !value);
              setSelectedUserIds([]);
              setBatchDeleteGradeId('');
            }}
          >
            {batchDeleteMode ? '退出批量删除' : '批量删除账户'}
          </button>
          {batchDeleteMode && (
            <span className="user-management__batch-entry-count">已选择 {selectedUserIds.length} 个账号</span>
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
            options={[{ value: '', label: '全部角色' }, ...roles.map((role) => ({ value: role.id, label: role.name }))]}
          />
          <InlineSelect
            className="admin-input"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: '', label: '全部状态' },
              { value: 'active', label: '已启用' },
              { value: 'disabled', label: '已停用' },
            ]}
          />
          <span className="user-management__toolbar-count">共 {filteredUsers.length} 个账号</span>
        </div>
      )}
      <div className="user-management__groups" key={`${roleFilter}|${statusFilter}|${batchDeleteMode}`}>
        {userGroups.map((group) => {
          const expanded = !collapsedGroups[group.key];
          const allSelected = group.users.length > 0 && group.users.every((user) => selectedUserIds.includes(user.id));
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
                  <span className="user-management__group-caret" aria-hidden="true" />
                  <strong>{group.name}</strong>
                  {group.builtIn && <span className="user-management__group-badge">内置</span>}
                  <span className="user-management__group-count">{group.users.length} 人</span>
                </button>
                {batchDeleteMode && group.users.length > 0 && (
                  <label className="user-management__group-select">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(event) =>
                        setSelectedUserIds((ids) =>
                          event.target.checked
                            ? [...new Set([...ids, ...group.users.map((user) => user.id)])]
                            : ids.filter((id) => !group.users.some((user) => user.id === id)),
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
                    <div className="user-management__group-empty">该角色暂无账号</div>
                  ) : (
                    group.users.map((user) => (
                      <article
                        className={`user-management__row${user.status === 'disabled' ? ' is-disabled' : ''}${batchDeleteMode ? ' is-batch' : ''}`}
                        key={user.id}
                      >
                        {batchDeleteMode && user.id !== current?.id && (
                          <input
                            className="user-management__batch-check"
                            type="checkbox"
                            checked={selectedUserIds.includes(user.id)}
                            onChange={(event) =>
                              setSelectedUserIds((ids) =>
                                event.target.checked ? [...ids, user.id] : ids.filter((id) => id !== user.id),
                              )
                            }
                            aria-label={'选择 ' + user.displayName}
                          />
                        )}
                        <div className="user-management__identity">
                          <strong>
                            {user.displayName}
                            {user.id === current?.id && <span className="user-management__self">当前账号</span>}
                            {user.mustChangePassword && (
                              <span className="user-management__password-badge">首次登录需改密码</span>
                            )}
                          </strong>
                          <code>@{user.username}</code>
                        </div>
                        <div className="user-management__scope-cell" title={scopeText(user, grades, classes)}>
                          <span className="user-management__role">{user.roleName}</span>
                          <small>{scopeText(user, grades, classes)}</small>
                        </div>
                        <div className="user-management__status-cell" title={'最近登录：' + fmt(user.lastLoginAt)}>
                          <small>
                            <i
                              className={
                                'user-management__status-dot' +
                                (user.status === 'active' ? ' is-active' : ' is-disabled')
                              }
                              aria-hidden="true"
                            />
                            {user.status === 'active' ? '已启用' : '已停用'}
                          </small>
                        </div>
                        {(canEditUser || canResetPassword || canDeleteUser) && (
                          <div className="user-management__actions">
                            {canEditUser && (
                              <button className="admin-btn" onClick={() => beginEditUser(user)}>
                                编辑
                              </button>
                            )}
                            {(canResetPassword || canDeleteUser || user.id === current?.id) && (
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
  );
}
