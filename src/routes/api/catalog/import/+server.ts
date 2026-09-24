import * as XLSX from 'xlsx';
import { json } from '@sveltejs/kit';
import { importCatalog, maxAttachmentSize } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

function readRows(fileName: string, data: Buffer): { rows: Array<Record<string, unknown>>; errors: string[] } {
  const errors: string[] = [];
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(data, { type: 'buffer', cellDates: false }); }
  catch { return { rows: [], errors: ['文件无法解析，请上传有效的 CSV、XLS 或 XLSX 文件'] }; }
  const valid: Array<Record<string, unknown>> = [];
  const nameHeaders = new Set(['name', '名称', '服务名称', '产品名称', '材料名称']);
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    const headerIndex = matrix.findIndex((cells) => cells.some((cell) => nameHeaders.has(String(cell || '').trim())));
    if (headerIndex < 0) {
      errors.push(`${sheetName}：未识别到名称列，已忽略整个工作表`);
      continue;
    }
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { range: headerIndex, defval: '' });
    let previousName = '';
    rows.forEach((sourceRow, index) => {
      const row: Record<string, unknown> = { ...sourceRow, source_file: fileName, source_sheet: sheetName };
      let name = row.name || row['名称'] || row['服务名称'] || row['产品名称'] || row['材料名称'];
      const sequence = row['序号'];
      if (!String(name || '').trim() && previousName && sequence !== '' && Number.isFinite(Number(sequence))) {
        const nameKey = ['name', '名称', '服务名称', '产品名称', '材料名称'].find((key) => key in row) || 'name';
        row[nameKey] = previousName;
        name = previousName;
      }
      if (String(name || '').trim()) {
        previousName = String(name).trim();
        valid.push(row);
      } else if (Object.values(sourceRow).some((value) => String(value || '').trim())) {
        errors.push(`${sheetName} 第 ${headerIndex + index + 2} 行缺少名称，已忽略`);
      }
    });
  }
  if (!workbook.SheetNames.length) errors.push('文件没有可读取的工作表');
  return { rows: valid, errors };
}

export const POST: RequestHandler = async (event) => {
  const type = event.request.headers.get('content-type') || '';
  if (!type.includes('multipart/form-data')) return json({ error: { code: 'INVALID_CONTENT_TYPE', message: '请使用 multipart/form-data 上传资料库文件' } }, { status: 400 });
  const form = await event.request.formData();
  const identity = await event.locals.getCurrentIdentity();
  const file = form.get('file');
  const sourceId = String(form.get('source_id') || '');
  const mode = String(form.get('mode') || 'preview');
  const replace = String(form.get('replace') || '') === 'true';
  if (!(file instanceof File) || !file.size) return json({ error: { code: 'FILE_REQUIRED', message: '请选择资料库文件' } }, { status: 400 });
  if (file.size > maxAttachmentSize) return json({ error: { code: 'FILE_TOO_LARGE', message: '资料库文件不能超过 10MB' } }, { status: 413 });
  const parsed = readRows(file.name, Buffer.from(await file.arrayBuffer()));
  if (mode !== 'import') return json({ data: { file_name: file.name, sheet: parsed.rows[0]?.source_sheet || '', total_rows: parsed.rows.length + parsed.errors.length, valid_rows: parsed.rows.length, ignored_rows: parsed.errors.length, errors: parsed.errors.slice(0, 100), rows: parsed.rows.slice(0, 20) } });
  if (!identity || !['admin', 'manager', 'owner'].includes(identity.role)) return json({ error: { code: 'FORBIDDEN', message: '没有导入资料库权限' } }, { status: 403 });
  if (!sourceId) return json({ error: { code: 'SOURCE_REQUIRED', message: '请选择资料库来源' } }, { status: 400 });
  try {
    const count = importCatalog(parsed.rows, sourceId, { replace, actorName: identity.displayName });
    return json({ data: { imported: count, ignored: parsed.errors.length, errors: parsed.errors.slice(0, 100) } }, { status: 201 });
  } catch (reason) {
    return json({ error: { code: 'CATALOG_IMPORT_FAILED', message: reason instanceof Error ? reason.message : '资料库导入失败' } }, { status: 400 });
  }
};
