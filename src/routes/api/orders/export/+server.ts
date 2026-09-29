import { hasAnyRole, orderExportRoles, orderViewAllRoles } from '$lib/server/identity';
import { addAuditLog, exportOrders, listOrders } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const { url } = event;
  const identity = await event.locals.getCurrentIdentity();
  if (!identity) return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 });
  if (!hasAnyRole(identity, orderExportRoles)) return new Response(JSON.stringify({ message: '没有订单导出权限' }), { status: 403 });
  try {
    const filters = Object.fromEntries(url.searchParams);
    delete filters.actor;
    if (!hasAnyRole(identity, orderViewAllRoles)) {
      const requestedIds = new Set((filters.ids || '').split(',').filter(Boolean));
      const visibleIds = listOrders().filter((order) =>
        (order.created_by_uid === identity.uid || order.designer_uid === identity.uid || order.planner_uid === identity.uid) &&
        (!requestedIds.size || requestedIds.has(order.id))
      ).map((order) => order.id);
      if (!visibleIds.length) return new Response(JSON.stringify({ message: '没有可导出的订单' }), { status: 403 });
      filters.ids = visibleIds.join(',');
    }
    const result = exportOrders(filters);
    addAuditLog({ actorName: identity.displayName, actorUid: identity.uid, action: 'export', entityType: 'order', detail: { count: result.count, filters: Object.fromEntries(url.searchParams) } });
    const date = new Date().toISOString().slice(0, 10);
    return new Response(result.data, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`订单结算明细-${date}.xlsx`)}`, 'Content-Length': String(result.data.length), 'Cache-Control': 'no-store' } });
  } catch (reason) {
    return new Response(JSON.stringify({ message: reason instanceof Error ? reason.message : '订单导出失败' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
};
