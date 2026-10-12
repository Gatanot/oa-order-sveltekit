import type { JsonRecord } from './types';

const APP_ROUTE_SEGMENTS = new Set(['orders', 'reimbursements', 'catalog', 'admin', 'employees', 'api']);

export function appPath(path: string, pathname?: string): string {
  if (!path.startsWith('/')) return path;
  const currentPath = pathname ?? (typeof window === 'undefined' ? undefined : window.location.pathname);
  if (!currentPath) return path;
  const segments = currentPath.split('/').filter(Boolean);
  const routeIndex = segments.findIndex((segment) => APP_ROUTE_SEGMENTS.has(segment));
  const routeDepth = routeIndex < 0 ? 0 : Math.max(segments.length - routeIndex - 1, 0);
  return `${'../'.repeat(routeDepth)}${path.slice(1)}`;
}

// 返回应用根目录的绝对 URL（含网关路径前缀，结尾带 /）。
// 静态资源（pdf.js 的 cmaps / standard_fonts）在 worker 中按目录拼接文件名请求，
// 必须用绝对地址，否则会被解析到 worker 脚本所在目录。
export function appBaseUrl(): string {
  if (typeof window === 'undefined') return '/';
  const segments = window.location.pathname.split('/').filter(Boolean);
  const routeIndex = segments.findIndex((segment) => APP_ROUTE_SEGMENTS.has(segment));
  const prefix = routeIndex < 0 ? '' : `/${segments.slice(0, routeIndex).join('/')}`;
  return `${window.location.origin}${prefix}/`;
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
  delete<T>(path: string, body?: JsonRecord) {
    return request<T>(path, { method: 'DELETE', ...(body ? { body: JSON.stringify(body) } : {}) });
  }
};
