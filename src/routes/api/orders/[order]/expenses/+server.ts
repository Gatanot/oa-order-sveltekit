import { audit, findOrder, getDb, isoNow, moneyToCents, touch, uuid } from '$lib/server/db';
import { action, body, requiredText } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => getDb().transaction(() => {
    const db = getDb(), order = findOrder(db, event.params.order);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    const id = uuid(), amount = moneyToCents(data.amount), created = isoNow();
    const expenseNo = `EXP-${created.slice(0, 4)}-${event.params.order.replace(/^ORD-/, '').slice(-3)}-${uuid().slice(0, 8).toUpperCase()}`;
    if (amount <= 0) throw new Error('INVALID_MONEY');
    db.prepare('INSERT INTO expenses(id,order_id,category,amount,payment_type,payer,status,proof,occurred_on,created_at,expense_no,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, order.id, requiredText(data.category, 'CATEGORY_REQUIRED'), amount, String(data.payment_type || '员工垫付'), String(data.payer || ''), '待审核', String(data.proof || '待上传凭证'), String(data.occurred_on || created.slice(0, 10)), created, expenseNo, String(data.note || ''));
    touch(db, order.id); audit(db, order.id, '新增项目费用', String(data.actor || 'user'), { expense_id: id, amount });
    return { data: db.prepare('SELECT * FROM expenses WHERE id=?').get(id) };
  })(), 201);
};
