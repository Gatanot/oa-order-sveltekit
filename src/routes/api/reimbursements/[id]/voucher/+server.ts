import { json } from '@sveltejs/kit';
import { generateReimbursementVoucher } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity) return json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  try { return json({ data: generateReimbursementVoucher(event.params.id, identity.displayName) }, { status: 201 }); }
  catch (reason) { return json({ message: reason instanceof Error ? reason.message : '生成单据失败' }, { status: 400 }); }
};
