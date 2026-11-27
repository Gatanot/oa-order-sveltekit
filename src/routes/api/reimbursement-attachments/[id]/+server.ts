import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addAuditLog, deleteReimbursementAttachment, getReimbursementAccessInfo, getReimbursementAttachment, readAttachmentFile } from '$lib/server/order-db';
import { canViewReimbursementContent } from '$lib/server/identity';

export const GET: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  const row = getReimbursementAttachment(event.params.id) as { reimbursement_id: string; file_name: string; mime_type: string; storage_path: string } | undefined;
  if (!row) return json({ message: '附件不存在或已被删除' }, { status: 404 });
  const reimbursement = getReimbursementAccessInfo(row.reimbursement_id);
  if (!identity || !reimbursement) return json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
  if (!canViewReimbursementContent(identity, reimbursement)) return json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
  addAuditLog({ actorName: identity.displayName, actorUid: identity.uid, action: 'download_attachment', entityType: 'reimbursement', detail: { attachment_id: event.params.id, file_name: row.file_name } });
  let data: Buffer;
  try { data = readAttachmentFile(row); } catch { return json({ message: '附件文件已丢失，请重新上传' }, { status: 404 }); }
  return new Response(new Uint8Array(data), { headers: { 'Content-Type': row.mime_type || 'application/octet-stream', 'Content-Length': String(data.length), 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`, 'Cache-Control': 'private, max-age=3600' } });
};

// 删除单张报销票据：与「删除报销」同一口径——本人且停留在待上传证明/待一级审核，或管理员/财务。
export const DELETE: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity) return json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const row = getReimbursementAttachment(event.params.id) as { reimbursement_id: string; file_name: string } | undefined;
  if (!row) return json({ error: { code: 'NOT_FOUND', message: '附件不存在或已被删除' } }, { status: 404 });
  const reimbursement = getReimbursementAccessInfo(row.reimbursement_id);
  if (!reimbursement) return json({ error: { code: 'NOT_FOUND', message: '报销记录不存在' } }, { status: 404 });
  const editable = ['pending_proof', 'pending_review'].includes(reimbursement.status);
  const canDelete = editable && (reimbursement.employee_uid === identity.uid || ['admin', 'finance'].includes(identity.role));
  if (!canDelete) return json({ error: { code: 'FORBIDDEN', message: '当前状态或身份不能删除该票据' } }, { status: 403 });
  try {
    const removed = deleteReimbursementAttachment(event.params.id, { name: identity.displayName, uid: identity.uid });
    return json({ data: removed });
  } catch (reason) {
    return json({ error: { code: 'NOT_FOUND', message: reason instanceof Error ? reason.message : '附件删除失败' } }, { status: 404 });
  }
};
