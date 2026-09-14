import { action, body } from '$lib/server/http';
import { deleteReimbursement, updateReimbursement } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = (event) => action(() => {
  deleteReimbursement(event.params.id);
  return { data: null };
});

export const PATCH: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => ({ data: updateReimbursement(event.params.id, String(data.status || ''), String(data.actor || '财务人员'), String(data.reject_reason || '')) }));
};
