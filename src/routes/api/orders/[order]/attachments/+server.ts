import { audit, findOrder, getDb, isoNow, uuid } from '$lib/server/db';
import { action, body, requiredText } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => getDb().transaction(() => {
    const db = getDb(), order = findOrder(db, event.params.order);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    const id = uuid(), name = requiredText(data.name, 'FILE_NAME_REQUIRED');
    db.prepare('INSERT INTO attachments(id,order_id,name,kind,related_type,related_id,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(
      id, order.id, name, String(data.kind || '项目附件'), String(data.related_type || 'order'),
      String(data.related_id || order.id), String(data.uploaded_by || data.actor || 'user'), isoNow()
    );
    if (data.related_type === 'expense' && data.related_id) {
      db.prepare('UPDATE expenses SET proof=? WHERE id=? AND order_id=?').run(name, data.related_id, order.id);
    }
    audit(db, order.id, '上传项目附件', String(data.actor || 'user'), { attachment_id: id, name });
    return { data: db.prepare('SELECT * FROM attachments WHERE id=?').get(id) };
  })(), 201);
};
