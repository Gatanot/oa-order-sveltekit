import { json } from '@sveltejs/kit';
import { getDb, getOrderDetail } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
  const data = getOrderDetail(getDb(), params.order);
  if (!data) return json({ error: 'ORDER_NOT_FOUND' }, { status: 404 });
  return json({ data });
};
