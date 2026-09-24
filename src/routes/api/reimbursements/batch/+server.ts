import { action, body } from '$lib/server/http';
import { updateReimbursementsBatch } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  const identity = await event.locals.getCurrentIdentity();
  if (!identity) return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 });
  const ids = Array.isArray(data.ids) ? data.ids.map(String) : [];
  return action(() => ({ data: updateReimbursementsBatch(ids, String(data.status || ''), identity.displayName, String(data.reject_reason || '')) }));
};
