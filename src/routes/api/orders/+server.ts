import { json } from '@sveltejs/kit';
import { createOrder, listOrders } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json({ data: listOrders() });
export const POST: RequestHandler = async ({ request }) => {
  try { return json({ data: createOrder(await request.json()) }, { status: 201 }); }
  catch (error) { return json({ message: error instanceof Error ? error.message : '订单保存失败' }, { status: 400 }); }
};
