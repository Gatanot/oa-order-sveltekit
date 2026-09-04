import { findOrder, getDb, moneyToCents } from '$lib/server/db';
import { recordFinance, returnAcceptance, settleProject, submitAcceptance } from '$lib/server/workflow';
import { action, body } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => getDb().transaction(() => {
    const db = getDb(), order = findOrder(db, event.params.order);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    const actor = String(data.actor || 'user');
    if (data.submitted === true) return { ok: true, ...(submitAcceptance(db, order.id, actor) as object) };
    if (data.submitted === false) return { ok: true, ...(returnAcceptance(db, order.id, actor) as object) };
    if (data.settled === true) {
      const result = settleProject(db, order.id, actor);
      if (data.invoice !== undefined || data.payment !== undefined) recordFinance(db, order.id, {
        invoice: data.invoice === undefined ? undefined : moneyToCents(data.invoice),
        payment: data.payment === undefined ? undefined : moneyToCents(data.payment)
      }, actor);
      return { ok: true, stage: result.stage };
    }
    if (data.invoice !== undefined || data.payment !== undefined) {
      const result = recordFinance(db, order.id, {
        invoice: data.invoice === undefined ? undefined : moneyToCents(data.invoice),
        payment: data.payment === undefined ? undefined : moneyToCents(data.payment)
      }, actor);
      return { ok: true, stage: result.stage };
    }
    if (data.selected_supplier !== undefined || data.procurement_status !== undefined) throw new Error('PROCUREMENT_STATE_OWNED_BY_PROCUREMENT_COMMAND');
    throw new Error('NO_WORKFLOW_COMMAND');
  })());
};
