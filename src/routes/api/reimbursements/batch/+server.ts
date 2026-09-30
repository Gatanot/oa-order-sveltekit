import { action, body } from '$lib/server/http';
import { ADMIN_UID, reimbursementActionRoles, hasAnyRole } from '$lib/server/identity';
import { canAdvanceReimbursement, getReimbursementAccessInfo, updateReimbursementsBatch } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  const identity = await event.locals.getCurrentIdentity();
  if (!identity) return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 });
  if (!hasAnyRole(identity, reimbursementActionRoles)) return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: '没有财务操作权限' } }), { status: 403 });
  const ids = Array.isArray(data.ids) ? data.ids.map(String) : [];
  const blocked = ids.some((id: string) => {
    const row = getReimbursementAccessInfo(id);
    if (!row) return false;
    // 固定管理员可用额外身份走完整流程；其他审核者不能处理自己的报销。
    if (identity.uid !== ADMIN_UID && row.employee_uid != null && row.employee_uid === identity.uid) return true;
    return !canAdvanceReimbursement(row.status, String(data.status || ''), identity.role);
  });
  if (blocked) {
    return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: '当前角色、状态或报销归属不允许执行此操作' } }), { status: 403 });
  }
  return action(() => ({ data: updateReimbursementsBatch(ids, String(data.status || ''), identity.displayName, String(data.reject_reason || ''), identity.uid) }));
};
