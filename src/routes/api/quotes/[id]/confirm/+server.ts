import { audit, getDb, isoNow, touch } from '$lib/server/db';
import { updateOrderStage } from '$lib/server/workflow';
import { action, body } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => getDb().transaction(() => {
    const db = getDb();
    const quote = db.prepare('SELECT * FROM quote_versions WHERE id=?').get(event.params.id) as { id: string; order_id: string; status: string; total: number; estimated_cost: number; proof: string } | undefined;
    if (!quote) throw new Error('QUOTE_NOT_FOUND');
    if (quote.status !== '草稿') throw new Error('QUOTE_NOT_DRAFT');
    const current = db.prepare('SELECT stage FROM orders WHERE id=?').get(quote.order_id) as { stage: string } | undefined;
    if (!current) throw new Error('ORDER_NOT_FOUND');
    if (current.stage !== '报价中') throw new Error('QUOTE_CONFIRM_STAGE_REQUIRED');
    const proof = String(data.proof || quote.proof || '').trim();
    if (!proof || proof === '待确认') throw new Error('QUOTE_PROOF_REQUIRED');
    db.prepare("UPDATE quote_versions SET status='已确认',confirmed_at=?,proof=? WHERE id=?").run(isoNow(), proof, quote.id);
    db.prepare("UPDATE quote_versions SET status='已作废' WHERE order_id=? AND id<>? AND status='已确认'").run(quote.order_id, quote.id);
    db.prepare('UPDATE orders SET contract_amount=?,budget_cost=? WHERE id=?').run(quote.total, quote.estimated_cost, quote.order_id);
    updateOrderStage(db, quote.order_id, '执行中', String(data.actor || 'user'));
    touch(db, quote.order_id); audit(db, quote.order_id, '确认报价版本', String(data.actor || 'user'), { quote_id: quote.id });
    return { ok: true };
  })());
};
