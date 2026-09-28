import { json } from '@sveltejs/kit';
import { body, action } from '$lib/server/http';
import { addAuditLog, createOrder, listOrders, resolveOrderEmployeeUid, setOrderEmployees } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  const identity = await locals.getCurrentIdentity();
  if (!identity) return json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const canSeeAll = ['admin', 'manager', 'owner'].includes(identity.role);
  const orders = listOrders().filter((order) => canSeeAll || order.created_by_uid === identity.uid || order.designer_uid === identity.uid || order.planner_uid === identity.uid);
  return json({ data: orders });
};
export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  const identity = await event.locals.getCurrentIdentity();
  if (!identity || identity.role === 'pending' || identity.role === 'finance') return json({ error: { code: 'FORBIDDEN', message: '没有创建订单权限' } }, { status: 403 });
  data.created_by = identity.displayName;
  return action(() => {
    // 在写订单前先校验员工 UID，避免订单已提交后 setOrderEmployees 再抛错导致部分写入。
    const designerUid = resolveOrderEmployeeUid(data.designer_uid, 'designer');
    const plannerUid = resolveOrderEmployeeUid(data.planner_uid, 'planner');
    const created = createOrder(data);
    setOrderEmployees(String(created.id), identity.uid, designerUid, plannerUid);
    addAuditLog({ actorName: String(data.created_by || '填写人'), action: 'create', entityType: 'order', entityId: String(created.id) });
    return { data: created };
  }, 201);
};
