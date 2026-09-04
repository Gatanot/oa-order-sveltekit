import { audit, findOrder, getDb, isoNow, moneyToCents, uuid } from '$lib/server/db';
import { action, body, requiredText } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => getDb().transaction(() => {
    const db = getDb(), order = findOrder(db, event.params.order);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    const id = uuid(), created = isoNow();
    db.prepare('INSERT INTO quote_versions VALUES(?,?,?,?,?,?,?,?,?)').run(id, order.id, requiredText(data.version, 'VERSION_REQUIRED'), '草稿', moneyToCents(data.total), moneyToCents(data.estimated_cost), null, String(data.proof || '待确认'), created);
    audit(db, order.id, '新增报价版本', String(data.actor || 'user'), { version: data.version });
    return { data: db.prepare('SELECT * FROM quote_versions WHERE id=?').get(id) };
  })(), 201);
};
