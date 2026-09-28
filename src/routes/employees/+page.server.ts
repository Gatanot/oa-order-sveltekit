import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { employeeManageRoles, hasAnyRole } from '$lib/server/identity';

export const load: PageServerLoad = async ({ locals }) => {
  const identity = await locals.getCurrentIdentity();
  if (!identity || !hasAnyRole(identity, employeeManageRoles)) error(403, '没有员工管理权限');
  return { role: identity.role };
};
