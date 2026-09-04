import { audit, findOrder, getDb } from '$lib/server/db';
import { action, body, requiredText } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => getDb().transaction(() => {
    const db = getDb(), order = findOrder(db, event.params.order);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    audit(db, order.id, requiredText(data.action, 'ACTION_REQUIRED'), String(data.actor || 'user'), data.payload);
    return { ok: true };
  })(), 201);
};
