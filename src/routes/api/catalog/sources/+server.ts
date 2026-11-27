import { json } from '@sveltejs/kit';
import { action, body } from '$lib/server/http';
import { catalogManageRoles, catalogViewRoles, hasAnyRole } from '$lib/server/identity';
import { addAuditLog, createCatalogSource, deleteCatalogSource, listCatalogSources } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  const identity = await locals.getCurrentIdentity();
  return json({ data: identity && hasAnyRole(identity, catalogViewRoles) ? listCatalogSources() : [] });
};
export const POST: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity || !hasAnyRole(identity, catalogManageRoles)) return json({ error: { code: 'FORBIDDEN', message: '没有管理资料库权限' } }, { status: 403 });
  const data = await body(event);
  return action(() => {
    const created = createCatalogSource(data) as { id: string };
    addAuditLog({ actorName: identity.displayName, actorUid: identity.uid, action: 'create', entityType: 'catalog_source', entityId: created.id });
    return { data: created };
  }, 201);
};

// 删除整个资料库来源：来源与其下条目一起软删除。
export const DELETE: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity || !hasAnyRole(identity, catalogManageRoles)) return json({ error: { code: 'FORBIDDEN', message: '没有管理资料库权限' } }, { status: 403 });
  const data = await body(event);
  return action(() => ({ data: deleteCatalogSource(data.id, { name: identity.displayName, uid: identity.uid }) }));
};
