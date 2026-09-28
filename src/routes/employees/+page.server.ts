import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const identity = await locals.getCurrentIdentity();
  if (!identity || !['admin', 'manager', 'owner'].includes(identity.role)) error(403, '没有员工管理权限');
  return { role: identity.role };
};
