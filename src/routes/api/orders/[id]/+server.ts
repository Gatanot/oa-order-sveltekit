import { json } from '@sveltejs/kit';
import { action, body } from '$lib/server/http';
import { hasAnyRole, orderDeleteRoles, orderManageRoles, orderViewAllRoles, getEmployeeDisplayName } from '$lib/server/identity';
import { addAuditLog, deleteOrder, getOrderAccessInfo, getOrderById, resolveOrderEmployeeUid, setOrderEmployees, updateOrder } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

/**
 * 订单明细按需加载：首屏列表只下发摘要，打开详情/编辑时再取产品行、成本行和关联报销。
 * 权限与列表一致——可看全部订单的身份，或该订单的录入人/设计师/策划人。
 */
export const GET: RequestHandler = async ({ params, locals }) => {
  const identity = await locals.getCurrentIdentity();
  if (!identity) return json({ error: { code: 'UNAUTHORIZED', message: '请通过 Catsco 登录后访问' } }, { status: 401 });
  const order = getOrderById(params.id);
  if (!order) return json({ error: { code: 'NOT_FOUND', message: '订单不存在' } }, { status: 404 });
  const canViewAll = hasAnyRole(identity, orderViewAllRoles);
  const isParticipant = order.created_by_uid === identity.uid || order.designer_uid === identity.uid || order.planner_uid === identity.uid;
  if (!canViewAll && !isParticipant) return json({ error: { code: 'FORBIDDEN', message: '没有查看该订单的权限' } }, { status: 403 });
  return json({ data: order });
};

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
    // 个人垫付的报销归属当前操作人，由服务端写入可信身份。
    data.advance_employee = identity.displayName;
    data.advance_employee_uid = identity.uid;
    // 参与者只能编辑订单内容，不能自行改动结款状态（由管理身份控制）。
    if (!canManage) data.payment_status = existing.payment_status;
    // 在写订单前先校验员工 UID，避免订单已提交后 setOrderEmployees 再抛错导致部分写入。
    const designerUid = resolveOrderEmployeeUid(data.designer_uid, 'designer');
    const plannerUid = resolveOrderEmployeeUid(data.planner_uid, 'planner');
    // 指派姓名统一取员工档案里的 display_name，避免把用户名写进订单。
    if (designerUid) data.designer = getEmployeeDisplayName(designerUid) || data.designer;
    if (plannerUid) data.planner = getEmployeeDisplayName(plannerUid) || data.planner;
    data.created_by = existing.created_by;
    const updated = updateOrder(event.params.id, data);
    setOrderEmployees(event.params.id, existing.created_by_uid as number, designerUid, plannerUid);
    addAuditLog({ actorName: identity?.displayName || '', actorUid: identity?.uid, action: 'update', entityType: 'order', entityId: event.params.id });
    return { data: updated };
  });
};
export const DELETE: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity || !hasAnyRole(identity, orderDeleteRoles)) return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: '没有删除订单权限' } }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  return action(() => {
    const existing = getOrderAccessInfo(event.params.id);
    if (!existing) throw new Error('ORDER_NOT_FOUND');
    // 管理员/老板可删除任意订单；执行只能删除自己创建或参与的订单，避免仅凭订单 ID 越权。
    const canDeleteAny = hasAnyRole(identity, orderManageRoles);
    const participant = existing.created_by_uid === identity.uid || existing.designer_uid === identity.uid || existing.planner_uid === identity.uid;
    if (!canDeleteAny && !participant) throw new Error('FORBIDDEN');
    deleteOrder(event.params.id);
    addAuditLog({ actorName: identity.displayName, actorUid: identity.uid, action: 'delete', entityType: 'order', entityId: event.params.id });
    return { ok: true };
  });
};
