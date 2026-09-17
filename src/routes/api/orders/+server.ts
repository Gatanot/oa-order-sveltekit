import { json } from '@sveltejs/kit';
import { body, action } from '$lib/server/http';
import { addAuditLog, createOrder, listOrders } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json({ data: listOrders() });
export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => {
    const created = createOrder(data);
    addAuditLog({ actorName: String(data.created_by || '填写人'), action: 'create', entityType: 'order', entityId: String(created.id) });
    return { data: created };
  }, 201);
};
