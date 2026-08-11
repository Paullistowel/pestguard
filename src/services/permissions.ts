import { Permissions, UserRole } from '@/types';

/**
 * Role matrix — the "User Accounts & Roles" feature in §4.
 *
 * Three roles, matching the proposal: the farm owner runs the deployment, a
 * field technician maintains hardware, and a project supervisor reviews data
 * for the report. The split that matters is that a supervisor can read and
 * export everything but cannot touch a live node — an academic reviewer
 * accidentally disarming a deterrent mid-trial would invalidate the field data.
 */

export const ROLE_MATRIX: Record<UserRole, Permissions> = {
  owner: {
    viewDashboard: true,
    armDisarm: true,
    editConfig: true,
    provisionNodes: true,
    manageUsers: true,
    exportData: true,
    labelEvents: true,
  },
  technician: {
    viewDashboard: true,
    armDisarm: true,
    editConfig: true,
    provisionNodes: true,
    manageUsers: false,
    exportData: true,
    labelEvents: true,
  },
  supervisor: {
    viewDashboard: true,
    armDisarm: false,
    editConfig: false,
    provisionNodes: false,
    manageUsers: false,
    exportData: true,
    labelEvents: true,
  },
};

export const ROLE_META: Record<
  UserRole,
  { label: string; blurb: string; icon: string; color: string }
> = {
  owner: {
    label: 'Farm Owner',
    blurb: 'Full control over nodes, configuration, users and data.',
    icon: 'shield-checkmark',
    color: '#35C77E',
  },
  technician: {
    label: 'Field Technician',
    blurb: 'Maintains and configures hardware. Cannot manage user accounts.',
    icon: 'construct',
    color: '#4EA8FF',
  },
  supervisor: {
    label: 'Project Supervisor',
    blurb: 'Read-only oversight with full export and labelling rights.',
    icon: 'school',
    color: '#A66BFF',
  },
};

export function can(role: UserRole, action: keyof Permissions): boolean {
  return ROLE_MATRIX[role][action];
}

export function denialReason(role: UserRole, action: keyof Permissions): string {
  const label = ROLE_META[role].label;
  const map: Record<keyof Permissions, string> = {
    viewDashboard: 'view the dashboard',
    armDisarm: 'arm or disarm nodes',
    editConfig: 'change node configuration',
    provisionNodes: 'add or remove nodes',
    manageUsers: 'manage user accounts',
    exportData: 'export data',
    labelEvents: 'label events',
  };
  return `Your role (${label}) cannot ${map[action]}. Ask the farm owner if you need this.`;
}

export const PERMISSION_LABELS: { key: keyof Permissions; label: string; detail: string }[] = [
  { key: 'viewDashboard', label: 'View dashboard & history', detail: 'Live status, event log, analytics' },
  { key: 'armDisarm', label: 'Arm / disarm nodes', detail: 'Enable or suspend deterrent firing' },
  { key: 'editConfig', label: 'Edit node configuration', detail: 'Sensitivity, pattern, quiet hours' },
  { key: 'provisionNodes', label: 'Provision nodes', detail: 'Pair new gateways, remove nodes' },
  { key: 'manageUsers', label: 'Manage users', detail: 'Invite, remove, change roles' },
  { key: 'exportData', label: 'Export data', detail: 'CSV and training-set downloads' },
  { key: 'labelEvents', label: 'Label events', detail: 'Confirm or reject AI classifications' },
];
