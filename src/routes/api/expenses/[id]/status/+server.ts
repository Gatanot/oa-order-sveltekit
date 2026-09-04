import { getDb, recomputeCost } from '$lib/server/db';
import { updateExpenseStatus } from '$lib/server/workflow';
import { action, body } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => getDb().transaction(() => {
    const db = getDb();
    const expense = db.prepare('SELECT * FROM expenses WHERE id=?').get(event.params.id) as { id: string; order_id: string; status: string; proof: string } | undefined;
    if (!expense) throw new Error('EXPENSE_NOT_FOUND');
    const status = String(data.status);
    updateExpenseStatus(db, expense, status, String(data.proof || expense.proof || ''), String(data.actor || 'user'));
    recomputeCost(db, expense.order_id);
    return { ok: true };
  })());
};
