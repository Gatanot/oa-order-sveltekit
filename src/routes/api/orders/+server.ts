import { json } from '@sveltejs/kit';
import { audit, getDb, isoNow, moneyToCents, uuid } from '$lib/server/db';
import { action, body, requiredText } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
  const data = getDb().prepare('SELECT * FROM orders ORDER BY updated_at DESC').all();
  return json({ data });
};

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => getDb().transaction(() => {
    const db = getDb(), created = isoNow(), id = uuid();
    const code = String(data.code || `ORD-${created.replace(/\D/g, '').slice(0, 17)}-${uuid().slice(0, 6).toUpperCase()}`);
    const customer = requiredText(data.customer, 'CUSTOMER_REQUIRED');
    const name = requiredText(data.name, 'NAME_REQUIRED');
    const contract = moneyToCents(data.contract_amount);
    const budget = moneyToCents(data.budget_cost);
    if (contract <= 0 || budget <= 0 || budget > contract) throw new Error('INVALID_ORDER_AMOUNTS');
    db.prepare('INSERT INTO orders(id,code,customer,name,owner,stage,contract_amount,budget_cost,actual_cost,created_at,updated_at,created_by,updated_by,version,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, code, customer, name, String(data.owner || ''), '报价中', contract, budget, 0, created, created, String(data.actor || 'system'), String(data.actor || 'system'), 1, null);
    db.prepare('INSERT INTO order_workflows(order_id,submitted,selected_supplier,procurement_status,settled) VALUES(?,?,?,?,?)').run(id, 0, null, '待选择', 0);
    audit(db, id, '创建订单', String(data.actor || 'user'));
    return { data: db.prepare('SELECT * FROM orders WHERE id=?').get(id) };
  })(), 201);
};
