import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOrderAttachment, readAttachmentFile } from '$lib/server/order-db';

interface AttachmentRow {
  id: string;
  order_id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  storage_path: string;
  created_at: string;
}

/** 在新窗口中直接显示附件内容（浏览器内预览图片与 PDF）。 */
export const GET: RequestHandler = (event) => {
  const row = getOrderAttachment(event.params.id) as AttachmentRow | undefined;
  if (!row) return json({ message: '附件不存在或已被删除' }, { status: 404 });
  let data: Buffer;
  try {
    data = readAttachmentFile(row);
  } catch {
    return json({ message: '附件文件已丢失，请重新上传' }, { status: 404 });
  }
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': row.mime_type || 'application/octet-stream',
      'Content-Length': String(data.length),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      'Cache-Control': 'private, max-age=3600'
    }
  });
};
