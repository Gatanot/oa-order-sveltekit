// Shared by the workbench and server authorization.
export const ADMIN_UID = 826;
export const departments = ['商务', '内务', '策划', '设计', '执行'] as const;

export const orderViewAllRoles = ['admin', 'manager', 'owner', 'finance'] as const;
export const orderManageRoles = ['admin', 'manager', 'owner'] as const;
export const orderExportRoles = ['admin', 'manager', 'owner', 'executor', 'finance'] as const;
export const orderCreateRoles = ['admin', 'manager', 'owner', 'executor'] as const;
export const reimbursementViewAllRoles = ['admin', 'manager', 'owner', 'finance'] as const;
export const reimbursementActionRoles = ['admin', 'manager', 'owner', 'finance'] as const;

export type ReimbursementStatusCode = 'pending_review' | 'pending_recheck' | 'pending_confirmation' | 'pending_payment' | 'paid' | 'rejected';

/**
 * 报销审批固定为三级审核，三级通过后进入财务执行。
 * 每一级默认按角色兜底；部门配置了审核人后，以配置的审核人为准（可多人，任一人处理即可）。
 */
export const reimbursementWorkflow = [
  { layer: 1, status: '待一级审核', code: 'pending_review', approveLabel: '审核通过', rejectLabel: '一级打回', defaultRoles: ['admin', 'manager'] },
  { layer: 2, status: '待二级审核', code: 'pending_recheck', approveLabel: '复核通过', rejectLabel: '二级打回', defaultRoles: ['finance'] },
  { layer: 3, status: '待三级审核', code: 'pending_confirmation', approveLabel: '确认报销', rejectLabel: '三级打回', defaultRoles: ['owner'] },
  { layer: 4, status: '待执行', code: 'pending_payment', approveLabel: '确认已执行', rejectLabel: '', defaultRoles: ['finance'] }
] as const;

export const reimbursementPaidStatus = '已执行';

export const reimbursementStatusLabels: Record<ReimbursementStatusCode, string> = {
  pending_review: '待一级审核',
  pending_recheck: '待二级审核',
  pending_confirmation: '待三级审核',
  rejected: '已打回',
  pending_payment: '待执行',
  paid: reimbursementPaidStatus
};

// 兼容数据库中的历史文字状态和旧前端请求。
const reimbursementStatusAliases: Record<string, ReimbursementStatusCode> = {
  '待核验': 'pending_review',
  '待审核': 'pending_review',
  '已提交待审核': 'pending_review',
  '待一级审核': 'pending_review',
  '已审核待复核': 'pending_recheck',
  '已审核待符合': 'pending_recheck',
  '待二级审核': 'pending_recheck',
  '已复核待确认': 'pending_confirmation',
  '待三级审核': 'pending_confirmation',
  '已打回': 'rejected',
  '待报销': 'pending_payment',
  '待打款': 'pending_payment',
  '已确认待执行': 'pending_payment',
  '待执行': 'pending_payment',
  '已报销': 'paid',
  '已执行': 'paid'
};

export function reimbursementStatusCode(value: unknown): ReimbursementStatusCode {
  const status = String(value ?? '').trim();
  if (status in reimbursementStatusAliases) return reimbursementStatusAliases[status];
  if (status in reimbursementStatusLabels) return status as ReimbursementStatusCode;
  return 'pending_review';
}

export function reimbursementStatusLabel(value: unknown): string {
  return reimbursementStatusLabels[reimbursementStatusCode(value)];
}

export function reimbursementStepForStatus(value: unknown) {
  const code = reimbursementStatusCode(value);
  return reimbursementWorkflow.find((step) => step.code === code) || null;
}

export function reimbursementNextCodeForLayer(layer: number): ReimbursementStatusCode | null {
  const next = reimbursementWorkflow.find((step) => step.layer === layer + 1);
  if (next) return next.code;
  return layer === 4 ? 'paid' : null;
}

export function reimbursementNextStatusForLayer(layer: number): string | null {
  const code = reimbursementNextCodeForLayer(layer);
  return code ? reimbursementStatusLabel(code) : null;
}

export function reimbursementStatusesForRole(role: string): string[] | null {
  const statuses = reimbursementWorkflow
    .filter((step) => (step.defaultRoles as readonly string[]).includes(role))
    .map((step) => step.status);
  return statuses.length ? statuses : null;
}

export const catalogViewRoles = ['admin', 'manager', 'owner', 'executor'] as const;
// 报价库/成本库的维护权限与可见权限保持一致：能看到的人都能编辑。
export const catalogManageRoles = catalogViewRoles;
export const employeeManageRoles = ['admin', 'manager', 'owner'] as const;
// 执行公司管理与员工管理同页展示，但仅老板、执行与系统管理员可维护。
export const executionCompanyManageRoles = ['admin', 'owner', 'executor'] as const;

export function hasAnyRole(identity: { role: string } | null | undefined, roles: readonly string[]) {
  return Boolean(identity && roles.includes(identity.role));
}
