import type { JsonRecord } from './types';

const APP_ROUTE_SEGMENTS = new Set(['orders', 'reimbursements', 'catalog', 'admin', 'api']);

export function appPath(path: string): string {
  if (!path.startsWith('/') || typeof window === 'undefined') return path;
  const segments = window.location.pathname.split('/').filter(Boolean);
  const routeIndex = segments.findIndex((segment) => APP_ROUTE_SEGMENTS.has(segment));
  const routeDepth = routeIndex < 0 ? 0 : Math.max(segments.length - routeIndex - 1, 0);
  return `${'../'.repeat(routeDepth)}${path.slice(1)}`;
}

export function currentAppPath(): string {
  if (typeof window === 'undefined') return '/';
  const segments = window.location.pathname.split('/').filter(Boolean);
  const routeIndex = segments.findIndex((segment) => APP_ROUTE_SEGMENTS.has(segment));
  return routeIndex < 0 ? '/' : `/${segments.slice(routeIndex).join('/')}`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(appPath(path), {
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
    let body: { detail?: string; message?: string; error?: { message?: string } } | undefined;
    try { body = JSON.parse(text) as typeof body; } catch { /* non-JSON error response */ }
    throw new Error(body?.error?.message || body?.detail || body?.message || text || fallback);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  get<T>(path: string) { return request<T>(path); },
  post<T>(path: string, body: JsonRecord = {}) {
    return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  },
  patch<T>(path: string, body: JsonRecord = {}) {
    return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  },
  delete<T>(path: string) {
    return request<T>(path, { method: 'DELETE' });
  }
};
