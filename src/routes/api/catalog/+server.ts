import { json } from '@sveltejs/kit';
import { importCatalog, listCatalog } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json({ data: listCatalog() });
export const POST: RequestHandler = async ({ request }) => {
  try { const body = await request.json(); return json({ data: importCatalog(Array.isArray(body.rows) ? body.rows : []) }); }
  catch (error) { return json({ message: error instanceof Error ? error.message : '报价成本导入失败' }, { status: 400 }); }
};
