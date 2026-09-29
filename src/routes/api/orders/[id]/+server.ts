import { action, body } from '$lib/server/http';
import { hasAnyRole, orderManageRoles } from '$lib/server/identity';
import { addAuditLog, deleteOrder, getOrderAccessInfo, resolveOrderEmployeeUid, setOrderEmployees, updateOrder } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
  const data = await body(event);
  const identity = await event.locals.getCurrentIdentity();
  return action(() => {
    const existing = getOrderAccessInfo(event.params.id);
    if (!existing) throw new Error('ORDER_NOT_FOUND');
    if (!identity) throw new Error('UNAUTHORIZED');
    const canManage = hasAnyRole(identity, orderManageRoles);
    const isParticipant = existing.created_by_uid === identity.uid || existing.designer_uid === identity.uid || existing.planner_uid === identity.uid;
    if (!canManage && !isParticipant) throw new Error('FORBIDDEN');
    if (!existing.created_by_uid) throw new Error('ORDER_CREATOR_UID_MISSING');
    // 参与者只能编辑订单内容，不能自行改动结款状态（由管理身份控制）。
    if (!canManage) data.payment_status = existing.payment_status;
    // 在写订单前先校验员工 UID，避免订单已提交后 setOrderEmployees 再抛错导致部分写入。
    const designerUid = resolveOrderEmployeeUid(data.designer_uid, 'designer');
    const plannerUid = resolveOrderEmployeeUid(data.planner_uid, 'planner');
    data.created_by = existing.created_by;
    const updated = updateOrder(event.params.id, data);
    setOrderEmployees(event.params.id, existing.created_by_uid as number, designerUid, plannerUid);
    addAuditLog({ actorName: identity?.displayName || '', actorUid: identity?.uid, action: 'update', entityType: 'order', entityId: event.params.id });
    return { data: updated };
  });
};
export const DELETE: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity || !hasAnyRole(identity, orderManageRoles)) return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: '没有删除订单权限' } }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  return action(() => {
  deleteOrder(event.params.id);
  addAuditLog({ actorName: identity.displayName, actorUid: identity.uid, action: 'delete', entityType: 'order', entityId: event.params.id });
  return { ok: true };
});
};
