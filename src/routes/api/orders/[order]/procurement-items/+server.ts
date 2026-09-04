import { audit, findOrder, getDb, isoNow, moneyToCents, recordCost, touch, uuid } from '$lib/server/db';
import { action, body, requiredText } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => getDb().transaction(() => {
    const db = getDb(), order = findOrder(db, event.params.order);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    const id = uuid();
    db.prepare('INSERT INTO procurement_items(id,order_id,name,budget,status,created_at) VALUES(?,?,?,?,?,?)').run(id, order.id, requiredText(data.name, 'PROCUREMENT_REQUIRED'), moneyToCents(data.budget), '待询价', isoNow());
    recordCost(db, { orderId: order.id, sourceType: 'procurement_item', sourceId: id, costType: '预计', amount: moneyToCents(data.budget), actor: String(data.actor || 'user') });
    db.prepare("UPDATE order_workflows SET procurement_status='待定标' WHERE order_id=?").run(order.id);
    touch(db, order.id); audit(db, order.id, '新增采购需求', String(data.actor || 'user'), { item_id: id });
    return { data: db.prepare('SELECT * FROM procurement_items WHERE id=?').get(id) };
  })(), 201);
};
