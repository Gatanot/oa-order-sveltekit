import { action, body } from '$lib/server/http';
import { ADMIN_UID } from '$lib/server/identity';
import { canAdvanceReimbursement, deleteReimbursement, getReimbursementAccessInfo, updateReimbursement } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  return action(() => {
  if (!identity) throw new Error('UNAUTHORIZED');
  const reimbursement = getReimbursementAccessInfo(event.params.id);
  if (!reimbursement) throw new Error('REIMBURSEMENT_NOT_FOUND');
  if (reimbursement.status !== 'pending_review' || (reimbursement.employee_uid !== identity.uid && !['admin', 'finance'].includes(identity.role))) throw new Error('FORBIDDEN');
  deleteReimbursement(event.params.id);
  return { data: null };
});
};

export const PATCH: RequestHandler = async (event) => {
  const data = await body(event);
  const identity = await event.locals.getCurrentIdentity();
  if (!identity) return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 });
  const row = getReimbursementAccessInfo(event.params.id);
  if (!row) return new Response(JSON.stringify({ error: { code: 'REIMBURSEMENT_NOT_FOUND' } }), { status: 404 });
  // 固定管理员可用额外身份走完整流程；其他审核者不能处理自己的报销。
  if (identity.uid !== ADMIN_UID && row.employee_uid != null && row.employee_uid === identity.uid) {
    return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: '不能审核本人提交的报销' } }), { status: 403 });
  }
  if (!canAdvanceReimbursement(row.status, String(data.status || ''), identity.role)) return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: '当前角色或状态不能执行此操作' } }), { status: 403 });
  return action(() => ({ data: updateReimbursement(event.params.id, String(data.status || ''), identity.displayName, String(data.reject_reason || ''), identity.uid) }));
};
