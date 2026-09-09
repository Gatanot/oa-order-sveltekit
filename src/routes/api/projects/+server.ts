import { json } from '@sveltejs/kit';
import { action, body } from '$lib/server/http';
import { createProject, listProjects, type CreateProjectInput } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => json({ data: listProjects(url.searchParams.get('customer_id') || undefined) });
export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => ({ data: createProject(data as unknown as CreateProjectInput) }), 201);
};
