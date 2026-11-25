import { json } from '@sveltejs/kit';
import { action, body } from '$lib/server/http';
import { createReimbursement, listReimbursementOrders, setReimbursementEmployee, withReimbursementActions } from '$lib/server/order-db';
import { canUseReimbursementReview, hasAnyRole, reimbursementViewAllRoles } from '$lib/server/identity';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity) return json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const rows = listReimbursementOrders(Object.fromEntries(event.url.searchParams));
  const requestedScope = event.url.searchParams.get('scope');
  const scope = requestedScope === 'review' ? 'review' : requestedScope === 'history' ? 'history' : 'mine';
  if (scope === 'mine') {
    return json({ data: rows.filter((item) => item.employee_uid === identity.uid) });
  }
  if (scope === 'review' && !canUseReimbursementReview(identity)) {
    return json({ error: { code: 'FORBIDDEN', message: '没有报销审核权限' } }, { status: 403 });
  }
  if (scope === 'history' && !hasAnyRole(identity, reimbursementViewAllRoles)) {
    return json({ error: { code: 'FORBIDDEN', message: '没有查看历史报销权限' } }, { status: 403 });
  }
  if (scope === 'history') {
    return json({ data: rows.filter((item) => item.reimbursement_status === '已执行') });
  }
  // 逐条按“部门配置的当前节点审核人”裁剪，未配置的部门继续按原角色兜底。
  const data = withReimbursementActions(rows, identity).filter((item) => item.can_act);
  return json({ data });
};
export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  const identity = await event.locals.getCurrentIdentity();
  if (!identity || identity.role === 'pending') return json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
  data.employee = identity.displayName;
  return action(() => {
    const reimbursement = createReimbursement(data, identity.uid);
    setReimbursementEmployee(String(reimbursement.id), identity.uid);
    return { data: reimbursement };
  }, 201);
};
