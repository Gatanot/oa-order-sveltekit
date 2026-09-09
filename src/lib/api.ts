import type { JsonRecord } from './types';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {})
    }
  });
  if (!response.ok) {
    const fallback = `请求失败（HTTP ${response.status}）`;
    const text = await response.text();
    if (!text) throw new Error(fallback);
    let body: { detail?: string; message?: string } | undefined;
    try { body = JSON.parse(text) as typeof body; } catch { /* non-JSON error response */ }
    throw new Error(body?.detail || body?.message || text || fallback);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  get<T>(path: string) { return request<T>(path); },
  post<T>(path: string, body: JsonRecord = {}) {
    return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  },
  delete<T>(path: string) {
    return request<T>(path, { method: 'DELETE' });
  }
};
