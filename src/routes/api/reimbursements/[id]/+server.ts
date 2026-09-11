import { action, body } from '$lib/server/http';
import { deleteStandaloneReimbursement, updateReimbursement, updateStandaloneReimbursement } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = (event) => action(() => {
  if (!event.params.id.startsWith('standalone:')) throw new Error('仅支持删除独立报销记录');
  deleteStandaloneReimbursement(event.params.id.slice('standalone:'.length));
  return { data: null };
});

export const PATCH: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => ({ data: event.params.id.startsWith('standalone:')
    ? updateStandaloneReimbursement(event.params.id.slice('standalone:'.length), String(data.status || ''), String(data.actor || '财务人员'))
    : updateReimbursement(event.params.id, String(data.status || ''), String(data.actor || '财务人员')) }));
};
