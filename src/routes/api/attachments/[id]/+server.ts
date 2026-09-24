import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addAuditLog, canEmployeeAccessOrder, getOrderAttachment, readAttachmentFile } from '$lib/server/order-db';

export const GET: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  const row = getOrderAttachment(event.params.id) as { order_id: string; file_name: string; mime_type: string; storage_path: string } | undefined;
  if (!row) return json({ message: '附件不存在或已被删除' }, { status: 404 });
  if (!identity || (!['admin', 'manager', 'owner'].includes(identity.role) && !canEmployeeAccessOrder(row.order_id, identity.uid))) return json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
  addAuditLog({ actorName: identity.displayName, action: 'download_attachment', entityType: 'order', detail: { attachment_id: event.params.id, file_name: row.file_name } });
  let data: Buffer;
  try { data = readAttachmentFile(row); } catch { return json({ message: '附件文件已丢失，请重新上传' }, { status: 404 }); }
  return new Response(new Uint8Array(data), { headers: { 'Content-Type': row.mime_type || 'application/octet-stream', 'Content-Length': String(data.length), 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`, 'Cache-Control': 'private, max-age=3600' } });
};
