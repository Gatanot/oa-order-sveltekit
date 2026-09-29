import { json } from '@sveltejs/kit';
import { action, body } from '$lib/server/http';
import { createReimbursement, listReimbursementOrders, setReimbursementEmployee } from '$lib/server/order-db';
import { hasAnyRole, reimbursementViewAllRoles } from '$lib/server/identity';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity) return json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const rows = listReimbursementOrders(Object.fromEntries(event.url.searchParams));
  const canSeeAll = hasAnyRole(identity, reimbursementViewAllRoles);
  const identityUid = identity.uid;
  return json({ data: canSeeAll ? rows : rows.filter((item) => item.employee_uid === identityUid) });
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
