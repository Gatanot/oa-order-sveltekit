import type { LayoutServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { loadWorkspace } from '$lib/server/workspace';

export const load: LayoutServerLoad = ({ params }) => {
  const data = loadWorkspace('dashboard', params.order);
  if (!data.order) error(404, '项目不存在');
  return data;
};
