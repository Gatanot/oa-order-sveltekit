import { json } from '@sveltejs/kit';
import type { CurrentIdentity } from '$lib/server/identity';
import { catalogManageRoles, catalogViewRoles, hasAnyRole } from '$lib/server/identity';
import { action, body } from '$lib/server/http';
import { createCustomerProfile, deleteCustomerProfile, listCustomerProfiles, updateCustomerProfile } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

// 客户档案独立于订单与资料库，仅复用报价库页面的查看/维护权限。
function requireRole(identity: CurrentIdentity | null, roles: readonly string[], message: string) {
  return hasAnyRole(identity, roles) ? null : json({ error: { code: 'FORBIDDEN', message } }, { status: 403 });
}

export const GET: RequestHandler = async ({ locals }) => {
  const identity = await locals.getCurrentIdentity();
  const denied = requireRole(identity, catalogViewRoles, '没有查看客户资料的权限');
  if (denied) return denied;
  return json({ data: listCustomerProfiles() });
};

export const POST: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  const denied = requireRole(identity, catalogManageRoles, '没有修改客户资料的权限');
  if (denied) return denied;
  const data = await body(event);
  return action(() => ({ data: createCustomerProfile(data, { name: identity?.displayName, uid: identity?.uid }) }));
};

export const PATCH: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  const denied = requireRole(identity, catalogManageRoles, '没有修改客户资料的权限');
  if (denied) return denied;
  const data = await body(event);
  return action(() => ({ data: updateCustomerProfile(data.id, data, { name: identity?.displayName, uid: identity?.uid }) }));
};

export const DELETE: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  const denied = requireRole(identity, catalogManageRoles, '没有修改客户资料的权限');
  if (denied) return denied;
  const data = await body(event);
  return action(() => ({ data: deleteCustomerProfile(data.id, { name: identity?.displayName, uid: identity?.uid }) }));
};
