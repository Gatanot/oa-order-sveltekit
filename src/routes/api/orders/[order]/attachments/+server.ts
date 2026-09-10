import { json } from '@sveltejs/kit';
import { addOrderAttachment, listOrderAttachments } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => json({ data: listOrderAttachments(params.order) });
// Empty implementation by design: only file metadata is persisted for now.
export const POST: RequestHandler = async ({ params, request }) => {
  const data = await request.json() as { file_name?: string; mime_type?: string; file_size?: number };
  if (!data.file_name?.trim()) return json({ message: '请填写文件名' }, { status: 400 });
  return json({ data: addOrderAttachment(params.order, { fileName: data.file_name.trim(), mimeType: data.mime_type, fileSize: data.file_size }) }, { status: 201 });
};
