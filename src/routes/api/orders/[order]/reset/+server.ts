import { audit, findOrder, getDb } from '$lib/server/db';
import { action, body } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => getDb().transaction(() => {
    const db = getDb(), order = findOrder(db, event.params.order);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    const procurement = db.prepare(`
      SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status='已定标' THEN 1 ELSE 0 END), 0) AS awarded
      FROM procurement_items WHERE order_id=?
    `).get(order.id) as { total: number; awarded: number };
    const selected = db.prepare("SELECT supplier FROM procurement_items WHERE order_id=? AND status='已定标' AND supplier IS NOT NULL ORDER BY awarded_at DESC LIMIT 1").get(order.id) as { supplier: string } | undefined;
    const procurementStatus = procurement.total === 0
      ? '待选择'
      : procurement.awarded === 0
        ? '待定标'
        : procurement.awarded < procurement.total
          ? '部分定标'
          : '已定标';
    db.prepare("UPDATE orders SET stage='执行中',updated_at=? WHERE id=?").run(new Date().toISOString(), order.id);
    db.prepare('UPDATE order_workflows SET submitted=0,selected_supplier=?,procurement_status=?,settled=0 WHERE order_id=?').run(selected?.supplier ?? null, procurementStatus, order.id);
    db.prepare("UPDATE tasks SET done=CASE WHEN title='确认客户二次验收时间' THEN 1 ELSE 0 END WHERE order_id=?").run(order.id);
    audit(db, order.id, '恢复演示初始状态', String(data.actor || 'user'));
    return { ok: true };
  })());
};
