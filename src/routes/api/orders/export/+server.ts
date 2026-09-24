import { addAuditLog, exportOrders } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const { url } = event;
  const identity = await event.locals.getCurrentIdentity();
  if (!identity) return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 });
  try {
    const filters = Object.fromEntries(url.searchParams);
    delete filters.actor;
    const result = exportOrders(filters);
    addAuditLog({ actorName: identity.displayName, action: 'export', entityType: 'order', detail: { count: result.count, filters: Object.fromEntries(url.searchParams) } });
    const date = new Date().toISOString().slice(0, 10);
    return new Response(result.data, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`订单结算明细-${date}.xlsx`)}`, 'Content-Length': String(result.data.length), 'Cache-Control': 'no-store' } });
  } catch (reason) {
    return new Response(JSON.stringify({ message: reason instanceof Error ? reason.message : '订单导出失败' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
};
