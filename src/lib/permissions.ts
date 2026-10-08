// Shared by the workbench and server authorization.
export const orderViewAllRoles = ['admin', 'manager', 'owner', 'finance'] as const;
export const orderManageRoles = ['admin', 'manager', 'owner'] as const;
export const orderExportRoles = ['admin', 'manager', 'owner', 'executor', 'finance'] as const;
export const orderCreateRoles = ['admin', 'manager', 'owner', 'executor'] as const;
export const reimbursementViewAllRoles = ['admin', 'manager', 'owner', 'finance'] as const;
export const reimbursementActionRoles = ['admin', 'manager', 'owner', 'finance'] as const;

export function reimbursementStatusesForRole(role: string): string[] | null {
  if (role === 'manager') return ['已提交待审核'];
  if (role === 'finance') return ['已审核待复核', '已确认待执行'];
  if (role === 'owner') return ['已复核待确认'];
  if (role === 'admin') return ['已提交待审核', '已审核待复核', '已复核待确认', '已确认待执行'];
  return null;
}
export const catalogViewRoles = ['admin', 'manager', 'owner', 'executor'] as const;
export const catalogManageRoles = ['admin', 'manager', 'owner'] as const;
export const employeeManageRoles = ['admin', 'manager', 'owner'] as const;

export function hasAnyRole(identity: { role: string } | null | undefined, roles: readonly string[]) {
  return Boolean(identity && roles.includes(identity.role));
}
