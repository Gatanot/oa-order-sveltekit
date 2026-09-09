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
    const detail = reason instanceof Error ? reason.message : String(reason);
    return json({ error: 'INVALID_REQUEST', detail }, { status: 400 });
  }
}
