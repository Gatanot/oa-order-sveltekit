import { action, body } from '$lib/server/http';
import { reimbursementActionRoles, hasAnyRole } from '$lib/server/identity';
import { updateReimbursementsBatch } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  const identity = await event.locals.getCurrentIdentity();
  if (!identity) return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 });
  if (!hasAnyRole(identity, reimbursementActionRoles)) return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: '没有财务操作权限' } }), { status: 403 });
  const ids = Array.isArray(data.ids) ? data.ids.map(String) : [];
  return action(() => ({ data: updateReimbursementsBatch(ids, String(data.status || ''), identity.displayName, String(data.reject_reason || '')) }));
};
