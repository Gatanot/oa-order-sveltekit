import { json } from '@sveltejs/kit';
import { action, body } from '$lib/server/http';
import { getReimbursementAccessInfo, requestReimbursementAmountChange } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  const identity = await event.locals.getCurrentIdentity();
  if (!identity) return json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const reimbursement = getReimbursementAccessInfo(event.params.id);
  if (!reimbursement) return json({ error: { code: 'REIMBURSEMENT_NOT_FOUND', message: '报销记录不存在' } }, { status: 404 });
  if (reimbursement.employee_uid !== identity.uid && !['admin', 'finance'].includes(identity.role)) {
    return json({ error: { code: 'FORBIDDEN', message: '只能修改本人的报销金额' } }, { status: 403 });
  }
  return action(() => ({
    data: requestReimbursementAmountChange(
      event.params.id,
      data.amount,
      data.reason,
      { name: identity.displayName, uid: identity.uid }
    )
  }));
};
