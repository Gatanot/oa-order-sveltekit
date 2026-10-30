import { json } from '@sveltejs/kit';
import { catalogManageRoles, catalogViewRoles, hasAnyRole } from '$lib/server/identity';
import { orderPermissions } from '$lib/server/ai-orders';
import type { RequestHandler } from './$types';

/** 当前有效业务身份；不接受客户端提供的 UID/角色。管理员额外身份与网页保持一致。 */
export const GET: RequestHandler = async ({ locals }) => {
  const identity = await locals.getCurrentIdentity();
  const headers = { 'Cache-Control': 'no-store' };
  if (!identity) return json({ error: { code: 'UNAUTHORIZED', message: '未取得当前 Catsco 用户身份，请登录后重新发起操作；无需向 AI 提供凭据' } }, { status: 401, headers });
  return json({ data: {
    ...identity,
    permissions: { catalog: {
      read: hasAnyRole(identity, catalogViewRoles),
      manage: hasAnyRole(identity, catalogManageRoles)
    }, orders: orderPermissions(identity) }
  } }, { headers });
};
