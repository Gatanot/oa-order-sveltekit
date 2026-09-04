import { audit, getDb, isoNow, moneyToCents, uuid } from '$lib/server/db';
import { action, body, requiredText } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => getDb().transaction(() => {
    const db = getDb();
    const item = db.prepare('SELECT * FROM procurement_items WHERE id=?').get(event.params.id) as { id: string; order_id: string } | undefined;
    if (!item) throw new Error('PROCUREMENT_NOT_FOUND');
    const id = uuid(), supplier = requiredText(data.supplier, 'OFFER_REQUIRED'), amount = moneyToCents(data.amount);
    if (amount <= 0) throw new Error('OFFER_REQUIRED');
    db.prepare('INSERT INTO procurement_offers VALUES(?,?,?,?,?,?,?)').run(id, item.id, supplier, amount, String(data.proof || '待补报价凭证'), '待选定', isoNow());
    audit(db, item.order_id, '新增供应商报价', String(data.actor || 'user'), { item_id: item.id, offer_id: id, supplier, amount });
    return { data: db.prepare('SELECT * FROM procurement_offers WHERE id=?').get(id) };
  })(), 201);
};
