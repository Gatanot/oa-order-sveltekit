import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { executionCompanyManageRoles, employeeManageRoles, hasAnyRole } from '$lib/server/identity';

export const load: PageServerLoad = async ({ locals }) => {
  const identity = await locals.getCurrentIdentity();
  // 该页同时承载员工管理与执行公司管理，执行身份可进入但只能看到执行公司部分。
  if (!identity || (!hasAnyRole(identity, employeeManageRoles) && !hasAnyRole(identity, executionCompanyManageRoles))) error(403, '没有员工管理权限');
  return { role: identity.role };
};
