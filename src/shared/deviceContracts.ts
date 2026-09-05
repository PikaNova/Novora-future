import { asFiniteNumber, asRecord } from './typeGuards.js';

export type DeviceCommandAction = 'pause' | 'resume' | 'extend' | 'end';

export interface DeviceBinding {
  gradeId: string;
  classId: string;
  revoked: boolean;
  isManagement?: boolean;
}

export interface DeviceCommand {
  id: string;
  action: DeviceCommandAction;
  minutes?: number;
  createdAt: number;
}

export interface DeviceBindingInfo extends DeviceBinding {
  instanceId: string;
  managementRoleName?: string;
  managementScopeLabel?: string;
  page: string;
  clientVersion: string;
  status: string;
  currentExam: string;
  currentSubject: string;
  examStart: string;
  examEnd: string;
  lastSeenAt: number;
  updatedAt: number;
}

export interface PluginBindingInfo {
  pluginInstanceId: string;
  viewerInstanceId: string;
  gradeId: string;
  classId: string;
  paired: boolean;
  pluginLastSeenAt: number;
  viewerLastSeenAt: number;
}

export interface DeviceSetupConflict {
  instanceId: string;
  status: string;
  lastSeenAt: number;
  online: boolean;
}

export type DeviceInstanceRow = {
  instance_id?: unknown;
  grade_id?: unknown;
  class_id?: unknown;
  revoked?: unknown;
  is_management?: unknown;
  management_actor_id?: unknown;
  management_role_name?: unknown;
  management_scope_label?: unknown;
  page?: unknown;
  client_version?: unknown;
  status?: unknown;
  current_exam?: unknown;
  current_subject?: unknown;
  exam_start?: unknown;
  exam_end?: unknown;
  temporary_command?: unknown;
  last_seen_at?: unknown;
  updated_at?: unknown;
};

export type PluginInstanceRow = {
  plugin_instance_id?: unknown;
  grade_id?: unknown;
  class_id?: unknown;
  viewer_instance_id?: unknown;
  paired?: unknown;
  viewer_last_seen_at?: unknown;
  updated_at?: unknown;
};

const DEVICE_COMMAND_ACTIONS = new Set<DeviceCommandAction>(['pause', 'resume', 'extend', 'end']);

export function isDeviceCommandAction(value: unknown): value is DeviceCommandAction {
  return typeof value === 'string' && DEVICE_COMMAND_ACTIONS.has(value as DeviceCommandAction);
}

export function parseDeviceCommand(value: unknown): DeviceCommand | null {
  const source = asRecord(value);
  const id = typeof source.id === 'string' ? source.id : '';
  const createdAt = asFiniteNumber(source.createdAt);
  if (!id || !isDeviceCommandAction(source.action) || createdAt === undefined) return null;
  const minutes = asFiniteNumber(source.minutes);
  return {
    id,
    action: source.action,
    createdAt,
    ...(minutes === undefined ? {} : { minutes }),
  };
}

export function parseDeviceBinding(value: unknown): DeviceBinding | null {
  const source = asRecord(value);
  if (typeof source.gradeId !== 'string' || typeof source.classId !== 'string' || typeof source.revoked !== 'boolean')
    return null;
  return {
    gradeId: source.gradeId,
    classId: source.classId,
    revoked: source.revoked,
    isManagement: source.isManagement === true,
  };
}

export function parseDeviceSetupConflict(value: unknown): DeviceSetupConflict | null {
  const source = asRecord(value);
  const lastSeenAt = asFiniteNumber(source.lastSeenAt);
  if (
    typeof source.instanceId !== 'string' ||
    typeof source.status !== 'string' ||
    lastSeenAt === undefined ||
    typeof source.online !== 'boolean'
  )
    return null;
  return {
    instanceId: source.instanceId,
    status: source.status,
    lastSeenAt,
    online: source.online,
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function timestamp(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseDeviceBindingInfo(value: unknown): DeviceBindingInfo | null {
  const source = asRecord(value);
  const binding = parseDeviceBinding(source);
  const instanceId = text(source.instanceId);
  if (!binding || !instanceId) return null;
  return {
    ...binding,
    instanceId,
    managementRoleName: text(source.managementRoleName) || undefined,
    managementScopeLabel: text(source.managementScopeLabel) || undefined,
    page: text(source.page),
    clientVersion: text(source.clientVersion),
    status: text(source.status),
    currentExam: text(source.currentExam),
    currentSubject: text(source.currentSubject),
    examStart: text(source.examStart),
    examEnd: text(source.examEnd),
    lastSeenAt: timestamp(source.lastSeenAt),
    updatedAt: timestamp(source.updatedAt),
  };
}

export function parsePluginBindingInfo(value: unknown): PluginBindingInfo | null {
  const source = asRecord(value);
  const pluginInstanceId = text(source.pluginInstanceId);
  if (!pluginInstanceId) return null;
  return {
    pluginInstanceId,
    viewerInstanceId: text(source.viewerInstanceId),
    gradeId: text(source.gradeId),
    classId: text(source.classId),
    paired: source.paired === true,
    pluginLastSeenAt: timestamp(source.updatedAt),
    viewerLastSeenAt: timestamp(source.viewerLastSeenAt),
  };
}
