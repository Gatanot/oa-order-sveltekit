import { json } from '@sveltejs/kit';
import { addOrderAttachment, getOrderAccessInfo, markOrderCompleted, maxAttachmentSize } from '$lib/server/order-db';
import { hasAnyRole, orderManageRoles } from '$lib/server/identity';
import type { RequestHandler } from './$types';

/**
 * 完成订单：接单设计师、录入人或管理角色可将订单从“已提交”标记为“已完成”。
 * 设计师（订单指定设计师本人）完成时必须上传至少一张设计图。
 */
export const POST: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity) return json({ error: { code: 'UNAUTHORIZED', message: '请先登录' } }, { status: 401 });
  const existing = getOrderAccessInfo(event.params.id);
  if (!existing) return json({ error: { code: 'ORDER_NOT_FOUND', message: '订单不存在' } }, { status: 404 });

  const isDesigner = existing.designer_uid !== null && existing.designer_uid === identity.uid;
  const isCreator = existing.created_by_uid !== null && existing.created_by_uid === identity.uid;
  const canManage = hasAnyRole(identity, orderManageRoles);
  if (!isDesigner && !isCreator && !canManage) {
    return json({ error: { code: 'FORBIDDEN', message: '只有接单设计师、录入人或管理人员可以完成订单' } }, { status: 403 });
  }

  const contentType = event.request.headers.get('content-type') || '';
  let files: File[] = [];
  if (contentType.includes('multipart/form-data')) {
    const length = Number(event.request.headers.get('content-length') || 0);
    if (Number.isFinite(length) && length > maxAttachmentSize * 5 + 1024 * 1024) {
      return json({ message: '设计图合计不能超过 50MB，请分开上传' }, { status: 413 });
    }
    let form: FormData;
    try {
      form = await event.request.formData();
    } catch {
      return json({ message: '上传数据格式不正确' }, { status: 400 });
    }
    files = [...form.getAll('files'), ...form.getAll('file')].filter(
      (item): item is File => item instanceof File && item.size > 0,
    );
  }

  if (isDesigner && !files.length) {
    return json({ error: { code: 'DESIGN_IMAGE_REQUIRED', message: '设计师完成订单前必须上传设计图' } }, { status: 400 });
  }

  try {
    for (const file of files) {
      const data = Buffer.from(await file.arrayBuffer());
      addOrderAttachment(event.params.id, { name: file.name, data, kind: 'design' }, { name: identity.displayName, uid: identity.uid });
    }
    const result = markOrderCompleted(event.params.id, { name: identity.displayName, uid: identity.uid });
    return json({ data: { ...result, design_files: files.length } });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : '完成订单失败';
    return json({ error: { code: message, message } }, { status: /不能超过/.test(message) ? 413 : 400 });
  }
};
