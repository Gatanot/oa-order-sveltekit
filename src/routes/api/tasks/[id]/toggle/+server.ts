import { audit, getDb, touch } from '$lib/server/db';
import { action, body } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => getDb().transaction(() => {
    const db = getDb();
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(event.params.id) as { id: string; order_id: string } | undefined;
    if (!task) throw new Error('TASK_NOT_FOUND');
    const done = Number(Boolean(data.done));
    db.prepare('UPDATE tasks SET done=? WHERE id=?').run(done, task.id);
    touch(db, task.order_id);
    audit(db, task.order_id, '更新任务状态', String(data.actor || 'user'), { task_id: task.id, done });
    return { ok: true };
  })());
};
