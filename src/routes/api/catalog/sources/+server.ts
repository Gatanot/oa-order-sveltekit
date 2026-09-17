import { json } from '@sveltejs/kit';
import { action, body } from '$lib/server/http';
import { addAuditLog, createCatalogSource, listCatalogSources } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json({ data: listCatalogSources() });
export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => {
    const created = createCatalogSource(data) as { id: string };
    addAuditLog({ actorName: String(data.actor || '财务模式'), action: 'create', entityType: 'catalog_source', entityId: created.id });
    return { data: created };
  }, 201);
};
