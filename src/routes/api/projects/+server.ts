import { json } from '@sveltejs/kit';
import { createProject, listProjects } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => json({ data: listProjects(url.searchParams.get('customer_id') || undefined) });
export const POST: RequestHandler = async ({ request }) => {
  try { return json({ data: createProject(await request.json()) }, { status: 201 }); }
  catch (error) { return json({ message: error instanceof Error ? error.message : '项目创建失败' }, { status: 400 }); }
};
