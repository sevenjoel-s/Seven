import { RoleKey, UserAccount } from '../types/domain';

export type ModuleName =
  | 'messaging'
  | 'meetings'
  | 'scheduling'
  | 'directory'
  | 'support_desk'
  | 'customer_portal'
  | 'products'
  | 'orders'
  | 'finance'
  | 'admin'
  | 'hr'
  | 'security'
  | 'reports';

export type PermissionAction =
  | 'view'
  | 'create'
  | 'edit'
  | 'delete'
  | 'approve'
  | 'manage'
  | 'export'
  | 'share';

export const ROLE_LABELS: Record<RoleKey, string> = {
  super_admin: 'Super Administrator',
  company_admin: 'Company Administrator',
  it_admin: 'IT Administrator',
  hr_manager: 'HR Manager',
  department_manager: 'Department Manager',
  meeting_admin: 'Meeting Administrator',
  meeting_organizer: 'Meeting Organizer',
  meeting_moderator: 'Meeting Moderator',
  employee: 'Employee',
  support_agent: 'Customer Service Agent',
  customer: 'Customer',
  external_guest: 'External Guest',
};

export const ROLE_MATRIX: Record<RoleKey, string[]> = {
  super_admin: ['*:*'],
  company_admin: [
    'messaging:*', 'meetings:*', 'scheduling:*', 'directory:*',
    'support_desk:*', 'products:*', 'orders:*', 'finance:*', 'admin:*',
    'hr:*', 'security:view', 'reports:*',
  ],
  it_admin: [
    'messaging:*', 'meetings:*', 'scheduling:*', 'directory:view',
    'admin:view', 'admin:manage', 'security:*', 'reports:*',
  ],
  hr_manager: [
    'messaging:*', 'meetings:*', 'scheduling:*', 'directory:*',
    'hr:*', 'admin:view', 'admin:approve', 'reports:view', 'reports:export',
  ],
  department_manager: [
    'messaging:*', 'meetings:*', 'scheduling:*', 'directory:view',
    'support_desk:view', 'products:view', 'orders:view', 'finance:view', 'reports:view', 'reports:export',
  ],
  meeting_admin: [
    'messaging:view', 'messaging:create', 'meetings:*', 'scheduling:*',
    'directory:view', 'reports:view', 'reports:export',
  ],
  meeting_organizer: [
    'messaging:view', 'messaging:create', 'meetings:view', 'meetings:create', 'meetings:edit', 'meetings:share',
    'scheduling:view', 'scheduling:create', 'scheduling:edit', 'scheduling:share', 'directory:view',
  ],
  meeting_moderator: [
    'messaging:view', 'messaging:create', 'meetings:view', 'meetings:manage', 'meetings:share',
    'scheduling:view', 'directory:view',
  ],
  employee: [
    'messaging:view', 'messaging:create', 'messaging:edit', 'messaging:share',
    'meetings:view', 'meetings:create', 'meetings:share',
    'scheduling:view', 'scheduling:create', 'directory:view',
  ],
  support_agent: [
    'messaging:view', 'messaging:create', 'meetings:view', 'meetings:create',
    'scheduling:view', 'directory:view', 'support_desk:*', 'orders:view', 'orders:edit', 'orders:approve',
    'finance:view', 'finance:create', 'products:view',
  ],
  customer: [
    'customer_portal:*', 'orders:view', 'orders:create', 'finance:view', 'products:view',
  ],
  external_guest: [
    'meetings:view',
  ],
};

export function hasPermission(
  user: UserAccount | null | undefined,
  module: ModuleName,
  action: PermissionAction,
  customRolePermissions?: string[]
): boolean {
  if (!user || user.status !== 'active') return false;
  if (user.role === 'super_admin') return true;

  // Enforce strict isolation: customers can never access internal modules
  if (user.accountType === 'customer') {
    const allowedCustomerModules: ModuleName[] = ['customer_portal', 'orders', 'finance', 'products', 'meetings'];
    if (!allowedCustomerModules.includes(module)) return false;
  }

  const perms = customRolePermissions && customRolePermissions.length > 0
    ? customRolePermissions
    : (ROLE_MATRIX[user.role] || []);

  if (perms.includes('*:*')) return true;
  if (perms.includes(`${module}:*`)) return true;
  return perms.includes(`${module}:${action}`);
}

export function isAdminRole(role?: RoleKey): boolean {
  return role === 'super_admin' || role === 'company_admin' || role === 'it_admin' || role === 'hr_manager';
}
