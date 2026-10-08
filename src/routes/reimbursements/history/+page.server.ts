import { redirect } from '@sveltejs/kit';
import { hasAnyRole, reimbursementViewAllRoles } from '$lib/server/identity';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
  const { identity } = await parent();
  if (!hasAnyRole(identity, reimbursementViewAllRoles)) redirect(303, '../reimbursements');
};
