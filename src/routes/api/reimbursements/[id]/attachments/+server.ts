import { json } from '@sveltejs/kit';
import { addStandaloneReimbursementAttachment, getReimbursementAccessInfo, listReimbursementAttachments, maxAttachmentSize } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
  if (!getReimbursementAccessInfo(event.params.id)) return json({ message: '报销记录不存在' }, { status: 404 });
  return json({ data: listReimbursementAttachments(event.params.id) });
};
export const POST: RequestHandler = async (event) => {
  if (!getReimbursementAccessInfo(event.params.id)) return json({ message: '报销记录不存在' }, { status: 404 });
  const contentType = event.request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) return json({ message: '请使用 multipart/form-data 上传附件' }, { status: 400 });
  const length = Number(event.request.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > maxAttachmentSize + 1024 * 1024) return json({ message: '附件不能超过 10MB' }, { status: 413 });
  const form = await event.request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) return json({ message: '请选择发票附件' }, { status: 400 });
  try { return json({ data: addStandaloneReimbursementAttachment(event.params.id, { name: file.name, data: Buffer.from(await file.arrayBuffer()) }) }, { status: 201 }); }
  catch (reason) { return json({ message: reason instanceof Error ? reason.message : '附件保存失败' }, { status: 400 }); }
};
