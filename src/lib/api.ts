import type { JsonRecord } from './types';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) }
  });
  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const body = await response.json() as { detail?: string; message?: string };
      message = body.detail || body.message || message;
    } catch {
      const text = await response.text();
      if (text) message = text;
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  get<T>(path: string) { return request<T>(path); },
  post<T>(path: string, body: JsonRecord = {}) {
    return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }
};
