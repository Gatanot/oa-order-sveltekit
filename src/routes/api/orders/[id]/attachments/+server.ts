import { action, body } from '$lib/server/http';
import { addOrderAttachment, listOrderAttachments } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => action(() => ({ data: listOrderAttachments(event.params.id) }));
export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => ({ data: addOrderAttachment(event.params.id, {
    fileName: String(data.file_name || ''), mimeType: String(data.mime_type || ''), fileSize: Number(data.file_size || 0)
  }) }), 201);
};
