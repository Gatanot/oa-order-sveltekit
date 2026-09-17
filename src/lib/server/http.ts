import { error, json, type RequestEvent } from '@sveltejs/kit';

export async function body(event: RequestEvent): Promise<Record<string, unknown>> {
  const length = Number(event.request.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > 1024 * 1024) error(413, 'REQUEST_TOO_LARGE');
  try {
    const value: unknown = await event.request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) error(400, 'INVALID_JSON');
    return value as Record<string, unknown>;
  } catch (reason) {
    if (reason && typeof reason === 'object' && 'status' in reason) throw reason;
    error(400, 'INVALID_JSON');
  }
}

export function requiredText(value: unknown, code = 'REQUIRED'): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(code);
  return text;
}

export function action<T>(fn: () => T, status = 200) {
  try {
    return json(fn(), { status });
  } catch (reason) {
    if (reason && typeof reason === 'object' && 'status' in reason && typeof (reason as { status: unknown }).status === 'number') throw reason;
    const detail = reason instanceof Error ? reason.message : String(reason);
    const uniqueConflict = /UNIQUE constraint failed/.test(detail);
    const code = uniqueConflict ? 'CONFLICT' : detail;
    const message = uniqueConflict ? '相同记录已存在，请勿重复创建' : detail;
    const status = detail === 'FORBIDDEN' ? 403
      : detail === 'UNAUTHORIZED' ? 401
      : /NOT_FOUND|不存在|ATTACHMENT_FILE_MISSING/.test(detail) ? 404
      : /CONFLICT|已存在|重复|UNIQUE constraint failed/.test(detail) ? 409
      : /TOO_LARGE|不能超过/.test(detail) ? 413
      : 400;
    return json({ error: { code, message } }, { status });
  }
}
