import { action, body } from '$lib/server/http';
import { hasAnyRole, reimbursementActionRoles } from '$lib/server/identity';
import { deleteReimbursement, getReimbursementAccessInfo, updateReimbursement } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  return action(() => {
  if (!identity) throw new Error('UNAUTHORIZED');
  const reimbursement = getReimbursementAccessInfo(event.params.id);
  if (!reimbursement) throw new Error('REIMBURSEMENT_NOT_FOUND');
  if (reimbursement.employee_uid !== identity.uid && !hasAnyRole(identity, reimbursementActionRoles)) throw new Error('FORBIDDEN');
  deleteReimbursement(event.params.id);
  return { data: null };
});
};

export const PATCH: RequestHandler = async (event) => {
  const data = await body(event);
  const identity = await event.locals.getCurrentIdentity();
  if (!identity) return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 });
  if (!hasAnyRole(identity, reimbursementActionRoles)) return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: '没有财务操作权限' } }), { status: 403 });
  return action(() => ({ data: updateReimbursement(event.params.id, String(data.status || ''), identity.displayName, String(data.reject_reason || '')) }));
};
