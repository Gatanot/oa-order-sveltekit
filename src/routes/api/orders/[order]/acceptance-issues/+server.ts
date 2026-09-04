import { audit, findOrder, getDb, isoNow, uuid } from '$lib/server/db';
import { action, body, requiredText } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => getDb().transaction(() => {
    const db = getDb(), order = findOrder(db, event.params.order);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    const id = uuid();
    const created = isoNow();
    db.prepare('INSERT INTO acceptance_issues(id,order_id,description,owner,due_date,status,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?)').run(id, order.id, requiredText(data.description, 'ISSUE_REQUIRED'), String(data.owner || ''), String(data.due_date || ''), '待整改', created, created, 1);
    audit(db, order.id, '新增验收问题', String(data.actor || 'user'), { issue_id: id });
    return { data: db.prepare('SELECT * FROM acceptance_issues WHERE id=?').get(id) };
  })(), 201);
};
