import { json } from '@sveltejs/kit';
import { action, body } from '$lib/server/http';
import { hasAnyRole, orderManageRoles } from '$lib/server/identity';
import { createProject, deleteProject, listProjects } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => json({ data: listProjects(url.searchParams.get('customer') || undefined) });
export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => ({ data: createProject(data as any) }), 201);
};
// 删除项目：仅管理员/老板可删，且项目下还有订单或为系统归档项目时拒绝。
export const DELETE: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity || !hasAnyRole(identity, orderManageRoles)) return json({ error: { code: 'FORBIDDEN', message: '没有删除项目权限' } }, { status: 403 });
  const data = await body(event);
  return action(() => ({ data: deleteProject(data.id, { name: identity.displayName, uid: identity.uid }) }));
};
