import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { loadWorkspace } from '$lib/server/workspace';

const views = ['dashboard', 'orders', 'quotes', 'procure', 'accept', 'finance', 'expenses'];

export const load: PageServerLoad = ({ params }) => {
  if (!views.includes(params.view)) error(404, '页面不存在');
  const data = loadWorkspace(params.view, params.order);
  if (!data.order) error(404, '项目不存在');
  return data;
};
