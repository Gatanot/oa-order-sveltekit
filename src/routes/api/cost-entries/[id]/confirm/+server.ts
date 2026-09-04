import { getDb, recordCost } from '$lib/server/db';
import { action, body } from '$lib/server/http';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => getDb().transaction(() => {
    const db = getDb();
    const entry = db.prepare("SELECT * FROM cost_entries WHERE id=? AND status='有效'").get(event.params.id) as { id: string; order_id: string; source_type: string; source_id: string; amount: number; occurred_on: string } | undefined;
    if (!entry) throw new Error('COST_ENTRY_NOT_FOUND');
    if (entry.source_type === 'expense') throw new Error('EXPENSE_COST_FOLLOWS_REIMBURSEMENT');
    const actor = String(data.actor || 'user');
    recordCost(db, { orderId: entry.order_id, sourceType: entry.source_type, sourceId: entry.source_id, costType: '实际', amount: entry.amount, occurredOn: entry.occurred_on, actor });
    db.prepare("UPDATE cost_entries SET status='已冲销',created_by=?,created_at=? WHERE id=?").run(actor, new Date().toISOString(), entry.id);
    db.prepare('INSERT INTO audit_logs VALUES(?,?,?,?,?,?)').run(randomUUID(), entry.order_id, '确认成本实际发生', actor, JSON.stringify({ cost_entry_id: entry.id }), new Date().toISOString());
    return { ok: true };
  })());
};
