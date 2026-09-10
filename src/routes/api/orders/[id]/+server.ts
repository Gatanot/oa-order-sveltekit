import { action, body } from '$lib/server/http';
import { deleteOrder, updateOrder } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => ({ data: updateOrder(event.params.id, data) }));
};
export const DELETE: RequestHandler = (event) => action(() => {
  deleteOrder(event.params.id);
  return { ok: true };
});
