import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { loadWorkspace } from '$lib/server/workspace';

export const load: PageServerLoad = () => {
  const data = loadWorkspace();
  if (data.order) redirect(307, `/workspace/${encodeURIComponent(data.order.code)}/dashboard`);
  return data;
};
