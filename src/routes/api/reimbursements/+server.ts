import { json } from '@sveltejs/kit';
import { action, body } from '$lib/server/http';
import { createReimbursement, listReimbursementOrders, setReimbursementEmployee } from '$lib/server/order-db';
import { ADMIN_UID, hasAnyRole, reimbursementViewAllRoles } from '$lib/server/identity';
import { reimbursementStatusesForRole } from '$lib/permissions';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity) return json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const rows = listReimbursementOrders(Object.fromEntries(event.url.searchParams));
  const scope = event.url.searchParams.get('scope') === 'review' ? 'review' : 'mine';
  if (scope === 'mine') {
    return json({ data: rows.filter((item) => item.employee_uid === identity.uid) });
  }
  if (!hasAnyRole(identity, reimbursementViewAllRoles)) {
    return json({ error: { code: 'FORBIDDEN', message: '没有报销审核权限' } }, { status: 403 });
  }
  const responsibleStatuses = reimbursementStatusesForRole(identity.role) || [];
  const data = rows.filter((item) =>
    responsibleStatuses.includes(item.reimbursement_status) &&
    (identity.uid === ADMIN_UID || item.employee_uid !== identity.uid)
  );
  return json({ data });
};
export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  const identity = await event.locals.getCurrentIdentity();
  if (!identity || identity.role === 'pending') return json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
  data.employee = identity.displayName;
  return action(() => {
    const reimbursement = createReimbursement(data, identity.uid);
    setReimbursementEmployee(String(reimbursement.id), identity.uid);
    return { data: reimbursement };
  }, 201);
};
