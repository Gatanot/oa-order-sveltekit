import { error, json, type RequestEvent } from '@sveltejs/kit';

export async function body(event: RequestEvent): Promise<Record<string, any>> {
  const length = Number(event.request.headers.get('content-length') || 0);
  if (length > 1024 * 1024) error(413, 'REQUEST_TOO_LARGE');
  try {
    return await event.request.json();
  } catch {
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
