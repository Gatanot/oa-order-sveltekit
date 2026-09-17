import { addAuditLog, exportOrders } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
  const { url } = event;
  try {
    const result = exportOrders(Object.fromEntries(url.searchParams));
    addAuditLog({ actorName: url.searchParams.get('actor') || '查看模式', action: 'export', entityType: 'order', detail: { count: result.count, filters: Object.fromEntries(url.searchParams) } });
    const date = new Date().toISOString().slice(0, 10);
    return new Response(result.data, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`订单结算明细-${date}.xlsx`)}`, 'Content-Length': String(result.data.length), 'Cache-Control': 'no-store' } });
  } catch (reason) {
    return new Response(JSON.stringify({ message: reason instanceof Error ? reason.message : '订单导出失败' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
};
