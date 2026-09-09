import { json } from '@sveltejs/kit';
import { body, action } from '$lib/server/http';
import { createOrder, listOrders } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json({ data: listOrders() });
// Parse once before entering the synchronous database transaction.
export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => ({ data: createOrder(data) }), 201);
};
