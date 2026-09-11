import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getReimbursementAttachment, readAttachmentFile } from '$lib/server/order-db';

export const GET: RequestHandler = (event) => {
  const row = getReimbursementAttachment(event.params.id) as { file_name: string; mime_type: string; storage_path: string; file_size: number } | undefined;
  if (!row) return json({ message: '附件不存在或已被删除' }, { status: 404 });
  let data: Buffer;
  try { data = readAttachmentFile(row); } catch { return json({ message: '附件文件已丢失，请重新上传' }, { status: 404 }); }
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': row.mime_type || 'application/octet-stream',
      'Content-Length': String(data.length),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      'Cache-Control': 'private, max-age=3600'
    }
  });
};
