import { json } from '@sveltejs/kit';
import { action, body } from '$lib/server/http';
import { catalogManageRoles, catalogViewRoles, hasAnyRole } from '$lib/server/identity';
import { deleteCatalogItem, importCatalog, listCatalog } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  const identity = await locals.getCurrentIdentity();
  return json({ data: identity && hasAnyRole(identity, catalogViewRoles) ? listCatalog() : { quote: [], cost: [] } });
};
export const POST: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity || !hasAnyRole(identity, catalogManageRoles)) return json({ error: { code: 'FORBIDDEN', message: '没有修改资料库权限' } }, { status: 403 });
  const data = await body(event);
  return action(() => ({ data: importCatalog(Array.isArray(data.rows) ? data.rows as Array<Record<string, unknown>> : [], String(data.source_id || ''), { actorName: identity.displayName, actorUid: identity.uid, replace: Boolean(data.replace) }) }));
};
// 单条资料删除：软删除（active=0），订单里已保存的报价/成本行不受影响。
export const DELETE: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity || !hasAnyRole(identity, catalogManageRoles)) return json({ error: { code: 'FORBIDDEN', message: '没有修改资料库权限' } }, { status: 403 });
  const data = await body(event);
  return action(() => ({ data: deleteCatalogItem(data.kind, data.id, { name: identity.displayName, uid: identity.uid }) }));
};
