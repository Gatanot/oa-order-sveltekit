import { action, body } from '$lib/server/http';
import { addAuditLog, deleteOrder, getOrderAccessInfo, setOrderEmployees, updateOrder } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
  const data = await body(event);
  const identity = await event.locals.getCurrentIdentity();
  return action(() => {
    const existing = getOrderAccessInfo(event.params.id);
    if (!existing) throw new Error('ORDER_NOT_FOUND');
    if (!identity) throw new Error('UNAUTHORIZED');
    const canManage = ['admin', 'manager', 'owner'].includes(identity.role);
    const isParticipant = existing.created_by_uid === identity.uid || existing.designer_uid === identity.uid || existing.planner_uid === identity.uid;
    if (!canManage && !isParticipant) throw new Error('FORBIDDEN');
    data.created_by = existing.created_by;
    const updated = updateOrder(event.params.id, data);
    setOrderEmployees(event.params.id, existing.created_by_uid || identity.uid, String(data.designer || existing.designer), String(data.planner || existing.planner));
    addAuditLog({ actorName: identity?.displayName || '', action: 'update', entityType: 'order', entityId: event.params.id });
    return { data: updated };
  });
};
export const DELETE: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity || !['admin', 'manager', 'owner'].includes(identity.role)) return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: '没有删除订单权限' } }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  return action(() => {
  deleteOrder(event.params.id);
  addAuditLog({ actorName: identity.displayName, action: 'delete', entityType: 'order', entityId: event.params.id });
  return { ok: true };
});
};
