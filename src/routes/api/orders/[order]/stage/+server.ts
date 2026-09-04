import { findOrder, getDb } from '$lib/server/db';
import { passAcceptance, updateOrderStage } from '$lib/server/workflow';
import { action, body } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => getDb().transaction(() => {
    const db = getDb(), order = findOrder(db, event.params.order);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    const stage = String(data.stage), actor = String(data.actor || 'user');
    const result = stage === '已验收'
      ? passAcceptance(db, order.id, actor)
      : updateOrderStage(db, order.id, stage, actor);
    return { ok: true, stage: result.stage };
  })());
};
