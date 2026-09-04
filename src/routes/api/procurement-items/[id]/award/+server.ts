import { audit, getDb, isoNow, moneyToCents, recomputeCost, recordCost } from '$lib/server/db';
import { action, body, requiredText } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => getDb().transaction(() => {
    const db = getDb();
    const item = db.prepare('SELECT * FROM procurement_items WHERE id=?').get(event.params.id) as { id: string; order_id: string; budget: number } | undefined;
    if (!item) throw new Error('PROCUREMENT_NOT_FOUND');
    const offer = data.offer_id ? db.prepare('SELECT * FROM procurement_offers WHERE id=? AND item_id=?').get(data.offer_id, item.id) as { id: string; supplier: string; amount: number } | undefined : undefined;
    const supplier = offer?.supplier || requiredText(data.supplier, 'OFFER_REQUIRED');
    const amount = offer?.amount ?? moneyToCents(data.awarded_amount);
    if (amount <= 0) throw new Error('OFFER_REQUIRED');
    if (amount > item.budget && !data.approved) {
      audit(db, item.order_id, '拦截采购定标：超过预算', String(data.actor || 'user'), { item_id: item.id, supplier, amount, budget: item.budget });
      throw new Error('OVER_BUDGET_APPROVAL_REQUIRED');
    }
    db.prepare("UPDATE procurement_items SET status='已定标',supplier=?,awarded_amount=?,awarded_at=? WHERE id=?").run(supplier, amount, isoNow(), item.id);
    db.prepare("UPDATE procurement_offers SET status=CASE WHEN id=? THEN '已定标' ELSE '未选定' END WHERE item_id=?").run(offer?.id || '', item.id);
    const remaining = (db.prepare("SELECT COUNT(*) AS n FROM procurement_items WHERE order_id=? AND status<>'已定标'").get(item.order_id) as { n: number }).n;
    db.prepare('UPDATE order_workflows SET selected_supplier=?,procurement_status=? WHERE order_id=?').run(supplier, remaining ? '部分定标' : '已定标', item.order_id);
    recordCost(db, { orderId: item.order_id, sourceType: 'procurement', sourceId: item.id, costType: '承诺', amount, actor: String(data.actor || 'user') });
    recomputeCost(db, item.order_id); audit(db, item.order_id, amount > item.budget ? '批准超预算并完成采购定标' : '采购需求定标', String(data.actor || 'user'), { item_id: item.id, supplier, awarded_amount: amount, budget: item.budget });
    return { ok: true, supplier, awarded_amount: amount };
  })());
};
