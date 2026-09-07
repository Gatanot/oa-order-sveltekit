import { audit, findOrder, getDb } from '$lib/server/db';
import { action, body } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => getDb().transaction(() => {
    const db = getDb(), order = findOrder(db, event.params.order);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    db.prepare("UPDATE orders SET stage='执行中',updated_at=? WHERE id=?").run(new Date().toISOString(), order.id);
    db.prepare("UPDATE order_workflows SET submitted=0,selected_supplier=NULL,procurement_status='待选择',settled=0 WHERE order_id=?").run(order.id);
    db.prepare("UPDATE tasks SET done=CASE WHEN title='确认客户二次验收时间' THEN 1 ELSE 0 END WHERE order_id=?").run(order.id);
    audit(db, order.id, '恢复演示初始状态', String(data.actor || 'user'));
    return { ok: true };
  })());
};
