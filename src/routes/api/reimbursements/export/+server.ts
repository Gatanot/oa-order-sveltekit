import { addAuditLog, exportReimbursements } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity) return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 });
  const filters = Object.fromEntries(event.url.searchParams) as Record<string, string>;
  delete filters.actor;
  try {
    const result = exportReimbursements(filters);
    addAuditLog({ actorName: identity.displayName, action: 'export', entityType: 'reimbursement', detail: { mode: filters.mode || 'detail', count: result.count } });
    const date = new Date().toISOString().slice(0, 10);
    return new Response(result.data, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${result.name}-${date}.xlsx`)}`, 'Content-Length': String(result.data.length), 'Cache-Control': 'no-store' } });
  } catch (reason) { return new Response(JSON.stringify({ error: { code: 'EXPORT_FAILED', message: reason instanceof Error ? reason.message : '报销导出失败' } }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }
};
