import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, parent }) => {
  const { orders } = await parent();
  if (!orders.some((order) => order.id === params.id)) error(404, '订单不存在');

  return { orderId: params.id };
};
