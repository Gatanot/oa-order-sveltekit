import { json } from '@sveltejs/kit';
import { action } from '$lib/server/http';
import { addOrderAttachment, listOrderAttachments, maxAttachmentSize } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => action(() => ({ data: listOrderAttachments(event.params.id) }));
export const POST: RequestHandler = async (event) => {
  const contentType = event.request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) return json({ message: '请使用 multipart/form-data 上传附件' }, { status: 400 });
  const length = Number(event.request.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > maxAttachmentSize + 1024 * 1024) return json({ message: '附件总大小不能超过 10MB' }, { status: 413 });
  let form: FormData;
  try { form = await event.request.formData(); } catch { return json({ message: '附件上传数据格式不正确' }, { status: 400 }); }
  const files = [...form.getAll('files'), ...form.getAll('file')].filter((item): item is File => item instanceof File && item.size > 0);
  if (!files.length) return json({ message: '请选择要上传的附件' }, { status: 400 });
  const saved: unknown[] = [];
  for (const file of files) {
    try { saved.push(addOrderAttachment(event.params.id, { name: file.name, data: Buffer.from(await file.arrayBuffer()) })); }
    catch (reason) { return json({ message: `${file.name}：${reason instanceof Error ? reason.message : '附件保存失败'}` }, { status: 400 }); }
  }
  return json({ data: saved }, { status: 201 });
};
