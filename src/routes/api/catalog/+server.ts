import { json } from '@sveltejs/kit';
import { action, body } from '$lib/server/http';
import { catalogManageRoles, catalogViewRoles, hasAnyRole } from '$lib/server/identity';
import { importCatalog, listCatalog } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  const identity = await locals.getCurrentIdentity();
  return json({ data: identity && hasAnyRole(identity, catalogViewRoles) ? listCatalog() : [] });
};
export const POST: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity || !hasAnyRole(identity, catalogManageRoles)) return json({ error: { code: 'FORBIDDEN', message: '没有修改资料库权限' } }, { status: 403 });
  const data = await body(event);
  return action(() => ({ data: importCatalog(Array.isArray(data.rows) ? data.rows as Array<Record<string, unknown>> : [], String(data.source_id || ''), { actorName: identity.displayName, actorUid: identity.uid, replace: Boolean(data.replace) }) }));
};
