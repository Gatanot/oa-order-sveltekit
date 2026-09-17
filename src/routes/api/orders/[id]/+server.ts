import { action, body } from '$lib/server/http';
import { addAuditLog, deleteOrder, getOrderAccessInfo, updateOrder } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => {
    const existing = getOrderAccessInfo(event.params.id);
    if (!existing) throw new Error('ORDER_NOT_FOUND');
    data.created_by = String(data.created_by || existing.created_by || '填写人');
    const updated = updateOrder(event.params.id, data);
    addAuditLog({ actorName: String(data.created_by), action: 'update', entityType: 'order', entityId: event.params.id });
    return { data: updated };
  });
};
export const DELETE: RequestHandler = (event) => action(() => {
  deleteOrder(event.params.id);
  addAuditLog({ actorName: '财务模式', action: 'delete', entityType: 'order', entityId: event.params.id });
  return { ok: true };
});
