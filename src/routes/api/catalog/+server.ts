import { json } from '@sveltejs/kit';
import { action, body } from '$lib/server/http';
import { importCatalog, listCatalog } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json({ data: listCatalog() });
export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => ({ data: importCatalog(Array.isArray(data.rows) ? data.rows as Array<Record<string, unknown>> : []) }));
};
