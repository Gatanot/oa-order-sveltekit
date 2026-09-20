import { json } from '@sveltejs/kit';
import { action, body } from '$lib/server/http';
import { createReimbursement, listReimbursementOrders } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => json({ data: listReimbursementOrders(Object.fromEntries(event.url.searchParams)) });
export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => ({ data: createReimbursement(data) }), 201);
};
