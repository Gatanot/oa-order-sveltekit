import { getDb, getOrderDetail } from '$lib/server/db';
import type { OrderSummary } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
  const db = getDb();
  const orders = db.prepare('SELECT * FROM orders ORDER BY updated_at DESC').all() as OrderSummary[];
  const order = orders[0] ? getOrderDetail(db, orders[0].id) ?? null : null;
  return { orders, order };
};
