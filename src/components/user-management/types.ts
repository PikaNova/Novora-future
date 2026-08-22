export type UserDraft = {
  id?: number;
  username: string;
  displayName: string;
  password: string;
  roleId: string;
  status: 'active' | 'disabled';
  allScope: boolean;
  gradeIds: string[];
  classIds: string[];
};
export type RoleDraft = {
  id?: string;
  name: string;
  description: string;
  permissions: string[];
};
export type PasswordDraft = {
  current: string;
  username: string;
  next: string;
  confirm: string;
};
export type BatchUserDraft = { prefix: string; password: string; classIds: string[] };
export type BatchCredential = {
  displayName: string;
  username: string;
  password: string;
  gradeName: string;
  className: string;
};
