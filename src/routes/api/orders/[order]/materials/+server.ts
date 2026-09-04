import { audit, findOrder, getDb, moneyToCents, recomputeCost, recordCost, uuid } from '$lib/server/db';
import { action, body, requiredText } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => getDb().transaction(() => {
    const db = getDb(), order = findOrder(db, event.params.order);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    const id = uuid(), quantity = Number(data.quantity ?? 1), unitCost = moneyToCents(data.cost_unit ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('MATERIAL_REQUIRED');
    const total = data.cost_total === undefined ? Math.round(quantity * unitCost) : moneyToCents(data.cost_total);
    db.prepare('INSERT INTO material_lines(id,order_id,place,name,description,size,quantity,unit,quote_unit,quote_total,cost_unit,cost_total,supplier,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, order.id, String(data.place || ''), requiredText(data.name, 'MATERIAL_REQUIRED'), String(data.description || ''), String(data.size || ''), quantity, String(data.unit || ''), 0, 0, unitCost, total, String(data.supplier || ''), String(data.note || ''));
    recordCost(db, { orderId: order.id, sourceType: 'material', sourceId: id, costType: '预计', amount: total, actor: String(data.actor || 'user') });
    recomputeCost(db, order.id); audit(db, order.id, '新增物料成本', String(data.actor || 'user'), { material_id: id, cost_total: total });
    return { data: db.prepare('SELECT * FROM material_lines WHERE id=?').get(id) };
  })(), 201);
};
