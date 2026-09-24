import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addAuditLog, getReimbursementAccessInfo, getReimbursementAttachment, readAttachmentFile } from '$lib/server/order-db';

export const GET: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  const row = getReimbursementAttachment(event.params.id) as { reimbursement_id: string; file_name: string; mime_type: string; storage_path: string } | undefined;
  if (!row) return json({ message: '附件不存在或已被删除' }, { status: 404 });
  const reimbursement = getReimbursementAccessInfo(row.reimbursement_id);
  if (!identity || !reimbursement || (!['admin', 'manager', 'owner', 'finance'].includes(identity.role) && reimbursement.employee_uid !== identity.uid)) return json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
  addAuditLog({ actorName: identity.displayName, action: 'download_attachment', entityType: 'reimbursement', detail: { attachment_id: event.params.id, file_name: row.file_name } });
  let data: Buffer;
  try { data = readAttachmentFile(row); } catch { return json({ message: '附件文件已丢失，请重新上传' }, { status: 404 }); }
  return new Response(new Uint8Array(data), { headers: { 'Content-Type': row.mime_type || 'application/octet-stream', 'Content-Length': String(data.length), 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`, 'Cache-Control': 'private, max-age=3600' } });
};
