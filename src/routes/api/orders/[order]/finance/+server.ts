import { json } from '@sveltejs/kit';
import { findOrder, getDb } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
  const db = getDb();
  const order = findOrder(db, params.order);
  if (!order) return json({ error: 'ORDER_NOT_FOUND' }, { status: 404 });
  return json({
    invoices: db.prepare("SELECT * FROM invoices WHERE order_id=? ORDER BY created_at DESC").all(order.id),
    payments: db.prepare('SELECT * FROM payments WHERE order_id=? ORDER BY paid_on DESC,created_at DESC').all(order.id),
    costs: db.prepare('SELECT * FROM cost_entries WHERE order_id=? ORDER BY occurred_on DESC,created_at DESC').all(order.id)
  });
};
