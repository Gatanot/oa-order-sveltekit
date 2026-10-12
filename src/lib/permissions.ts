// Shared by the workbench and server authorization.
export const orderViewAllRoles = ['admin', 'manager', 'owner', 'finance'] as const;
export const orderManageRoles = ['admin', 'manager', 'owner'] as const;
export const orderExportRoles = ['admin', 'manager', 'owner', 'executor', 'finance'] as const;
export const orderCreateRoles = ['admin', 'manager', 'owner', 'executor'] as const;
export const reimbursementViewAllRoles = ['admin', 'manager', 'owner', 'finance'] as const;
export const reimbursementActionRoles = ['admin', 'manager', 'owner', 'finance'] as const;

// 页面、批量操作与服务端共同使用当前身份的审批节点；admin 不跨节点处理。
const reimbursementWorkflow = [
  { status: '已提交待审核', roles: ['admin', 'manager'], target: '已审核待复核', label: '审核通过' },
  { status: '已审核待复核', roles: ['finance'], target: '已复核待确认', label: '复核通过' },
  { status: '已复核待确认', roles: ['owner'], target: '已确认待执行', label: '确认报销' },
  { status: '已确认待执行', roles: ['finance'], target: '已执行', label: '确认已执行' },
];

export function reimbursementStatusesForRole(role: string): string[] | null {
  const statuses = reimbursementWorkflow.filter((step) => step.roles.includes(role)).map((step) => step.status);
  return statuses.length ? statuses : null;
}

export function reimbursementActionForRole(status: string, role: string | undefined) {
  return reimbursementWorkflow.find((step) => step.status === status && step.roles.includes(role || '')) || null;
}

export function reimbursementNextStatus(status: string, role: string | undefined): string | null {
  return reimbursementActionForRole(status, role)?.target || null;
}
export const catalogViewRoles = ['admin', 'manager', 'owner', 'executor'] as const;
export const catalogManageRoles = ['admin', 'manager', 'owner'] as const;
export const employeeManageRoles = ['admin', 'manager', 'owner'] as const;

export function hasAnyRole(identity: { role: string } | null | undefined, roles: readonly string[]) {
  return Boolean(identity && roles.includes(identity.role));
}
