import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loadWorkbench } from '$lib/server/workbench';
export const load: PageServerLoad = ({ params }) => {
  const data = loadWorkbench();
  if (!data.orders.some((order) => order.id === params.id)) error(404, '订单不存在');
  return { ...data, orderId: params.id };
};
