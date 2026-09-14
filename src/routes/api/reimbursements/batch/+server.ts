import { action, body } from '$lib/server/http';
import { updateReimbursementsBatch } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  const ids = Array.isArray(data.ids) ? data.ids.map(String) : [];
  return action(() => ({
    data: updateReimbursementsBatch(
      ids,
      String(data.status || ''),
      String(data.actor || '财务人员'),
      String(data.reject_reason || ''),
    ),
  }));
};
