import { audit, findOrder, getDb, isoNow, touch, uuid } from '$lib/server/db';
import { action, body, requiredText } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => getDb().transaction(() => {
    const db = getDb(), order = findOrder(db, event.params.order);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    const id = uuid();
    db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?)').run(id, order.id, requiredText(data.title, 'TASK_REQUIRED'), Number(Boolean(data.done)), isoNow());
    touch(db, order.id);
    audit(db, order.id, '新增任务', String(data.actor || 'user'), { task_id: id });
    return { data: db.prepare('SELECT * FROM tasks WHERE id=?').get(id) };
  })(), 201);
};
