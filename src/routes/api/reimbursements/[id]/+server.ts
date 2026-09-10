import { json } from '@sveltejs/kit';
import { action, body } from '$lib/server/http';
import { updateReimbursement } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
  const data = await request.json() as { status?: string; actor?: string };
  return action(() => ({ data: updateReimbursement(params.id, String(data.status || ''), String(data.actor || '财务人员')) }));
};
