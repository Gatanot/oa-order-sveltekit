import { json } from '@sveltejs/kit';
import { getDb, getOrderDetail } from '$lib/server/db';
import { getOrderDb } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
  const data = getOrderDetail(getDb(), params.order);
  if (!data) return json({ error: 'ORDER_NOT_FOUND' }, { status: 404 });
  return json({ data });
};

export const DELETE: RequestHandler = ({ params }) => {
  const db = getOrderDb();
  const result = db.prepare('DELETE FROM orders_simple WHERE id=? OR code=?').run(params.order, params.order);
  if (!result.changes) return json({ message: '订单不存在或已被删除' }, { status: 404 });
  return new Response(null, { status: 204 });
};
