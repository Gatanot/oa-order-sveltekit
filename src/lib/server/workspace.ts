import { getDb, getOrderDetail } from '$lib/server/db';
import type { OrderSummary, WorkspaceData } from '$lib/types';

export function loadWorkspace(view = 'dashboard', orderCode?: string): WorkspaceData {
  const db = getDb();
  const orders = db.prepare('SELECT * FROM orders ORDER BY updated_at DESC').all() as OrderSummary[];
  const selected = orderCode ? orders.find((item) => item.code === orderCode) : orders[0];
  const order = selected ? getOrderDetail(db, selected.id) ?? null : null;
  return { orders, order, view };
}
