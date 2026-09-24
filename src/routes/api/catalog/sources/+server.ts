import { json } from '@sveltejs/kit';
import { action, body } from '$lib/server/http';
import { addAuditLog, createCatalogSource, listCatalogSources } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json({ data: listCatalogSources() });
export const POST: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity || !['admin', 'manager', 'owner'].includes(identity.role)) return json({ error: { code: 'FORBIDDEN', message: '没有管理资料库权限' } }, { status: 403 });
  const data = await body(event);
  return action(() => {
    const created = createCatalogSource(data) as { id: string };
    addAuditLog({ actorName: identity.displayName, action: 'create', entityType: 'catalog_source', entityId: created.id });
    return { data: created };
  }, 201);
};
