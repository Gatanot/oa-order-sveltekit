import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addAuditLog, canEmployeeAccessOrder, deleteOrderAttachment, getOrderAttachment, getOrderAccessInfo, readAttachmentFile } from '$lib/server/order-db';
import { hasAnyRole, orderManageRoles, orderViewAllRoles } from '$lib/server/identity';

export const GET: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  const row = getOrderAttachment(event.params.id) as { order_id: string; file_name: string; mime_type: string; storage_path: string } | undefined;
  if (!row) return json({ message: '附件不存在或已被删除' }, { status: 404 });
  if (!identity) return json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
  if (!hasAnyRole(identity, orderViewAllRoles) && !canEmployeeAccessOrder(row.order_id, identity.uid)) return json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
  addAuditLog({ actorName: identity.displayName, actorUid: identity.uid, action: 'download_attachment', entityType: 'order', detail: { attachment_id: event.params.id, file_name: row.file_name } });
  let data: Buffer;
  try { data = readAttachmentFile(row); } catch { return json({ message: '附件文件已丢失，请重新上传' }, { status: 404 }); }
  return new Response(new Uint8Array(data), { headers: { 'Content-Type': row.mime_type || 'application/octet-stream', 'Content-Length': String(data.length), 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`, 'Cache-Control': 'private, max-age=3600' } });
};

// 删除单个订单附件：管理角色，或该订单的录入人/设计师/策划人可以删。
export const DELETE: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity) return json({ error: { code: 'FORBIDDEN', message: '没有删除附件权限' } }, { status: 403 });
  const row = getOrderAttachment(event.params.id) as { order_id: string; file_name: string } | undefined;
  if (!row) return json({ error: { code: 'NOT_FOUND', message: '附件不存在或已被删除' } }, { status: 404 });
  const order = getOrderAccessInfo(row.order_id);
  if (!order) return json({ error: { code: 'NOT_FOUND', message: '订单不存在' } }, { status: 404 });
  const isParticipant = [order.created_by_uid, order.designer_uid, order.planner_uid].some((uid) => uid != null && uid === identity.uid);
  if (!hasAnyRole(identity, orderManageRoles) && !isParticipant) return json({ error: { code: 'FORBIDDEN', message: '没有删除附件权限' } }, { status: 403 });
  try {
    const removed = deleteOrderAttachment(event.params.id, { name: identity.displayName, uid: identity.uid });
    return json({ data: removed });
  } catch (reason) {
    return json({ error: { code: 'NOT_FOUND', message: reason instanceof Error ? reason.message : '附件删除失败' } }, { status: 404 });
  }
};
