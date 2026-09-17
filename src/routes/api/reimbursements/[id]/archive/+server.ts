import { json } from '@sveltejs/kit';
import { archiveReimbursementVoucher } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await event.request.json().catch(() => ({}));
  try { return json({ data: archiveReimbursementVoucher(event.params.id, String(data.actor || '财务人员')) }); }
  catch (reason) { return json({ error: { code: 'ARCHIVE_FAILED', message: reason instanceof Error ? reason.message : '归档失败' } }, { status: 400 }); }
};
