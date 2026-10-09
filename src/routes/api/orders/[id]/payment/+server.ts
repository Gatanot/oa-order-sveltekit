import { json } from '@sveltejs/kit';
import { getOrderAccessInfo, setOrderPaymentStatus } from '$lib/server/order-db';
import { hasAnyRole, orderManageRoles } from '$lib/server/identity';
import type { RequestHandler } from './$types';

/**
 * 切换订单结款状态（已结款 / 未结款）。
 * 仅管理身份（admin / manager / owner）可以修改，服务端为唯一授权依据。
 */
export const POST: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity) return json({ error: { code: 'UNAUTHORIZED', message: '请先登录' } }, { status: 401 });
  if (!hasAnyRole(identity, orderManageRoles)) {
    return json({ error: { code: 'FORBIDDEN', message: '没有修改结款状态的权限' } }, { status: 403 });
  }
  const existing = getOrderAccessInfo(event.params.id);
  if (!existing) return json({ error: { code: 'ORDER_NOT_FOUND', message: '订单不存在' } }, { status: 404 });

  const data = await event.request.json().catch(() => ({}));
  const requested = String(data?.payment_status || '');
  const target = requested === '已结款' || requested === '未结款'
    ? requested
    : (existing.payment_status === '已结款' ? '未结款' : '已结款');

  try {
    const result = setOrderPaymentStatus(event.params.id, target, { name: identity.displayName, uid: identity.uid });
    return json({ data: result });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : '结款状态更新失败';
    return json({ error: { code: message, message } }, { status: 400 });
  }
};
