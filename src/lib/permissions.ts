// Shared by the workbench and server authorization.
export const orderViewAllRoles = ['admin', 'manager', 'owner', 'finance'] as const;
export const orderManageRoles = ['admin', 'manager', 'owner'] as const;
export const orderExportRoles = ['admin', 'manager', 'owner', 'executor', 'finance'] as const;
export const orderCreateRoles = ['admin', 'manager', 'owner', 'executor', 'designer', 'planner'] as const;
export const reimbursementViewAllRoles = ['admin', 'manager', 'owner', 'finance'] as const;
export const reimbursementActionRoles = ['admin', 'owner', 'finance'] as const;
export const catalogManageRoles = ['admin', 'manager', 'owner', 'finance'] as const;
export const employeeManageRoles = ['admin', 'manager', 'owner'] as const;

export function hasAnyRole(identity: { role: string } | null | undefined, roles: readonly string[]) {
  return Boolean(identity && roles.includes(identity.role));
}
