import { json } from '@sveltejs/kit';
import { archiveReimbursementVoucher } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity) return json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  try { return json({ data: archiveReimbursementVoucher(event.params.id, identity.displayName) }); }
  catch (reason) { return json({ error: { code: 'ARCHIVE_FAILED', message: reason instanceof Error ? reason.message : '归档失败' } }, { status: 400 }); }
};
