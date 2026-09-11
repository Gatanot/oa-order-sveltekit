import { json } from '@sveltejs/kit';
import { createReimbursement, listReimbursementOrders } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => json({ data: listReimbursementOrders(Object.fromEntries(url.searchParams)) });

export const POST: RequestHandler = async (event) => {
  const data = await event.request.json();
  return json({ data: createReimbursement(data) }, { status: 201 });
};
