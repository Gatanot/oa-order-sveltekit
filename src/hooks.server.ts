import { json, type Handle, type HandleServerError } from '@sveltejs/kit';
import { getArtifactVisitor } from '$lib/server/artifact-visitor';
import { resolveIdentity } from '$lib/server/identity';

export const handle: Handle = async ({ event, resolve }) => {
  let visitor: ReturnType<typeof getArtifactVisitor> | undefined;
  event.locals.getArtifactVisitor = () => {
    visitor ??= getArtifactVisitor({
      cookie: event.request.headers.get('cookie') || '',
      authorization: event.request.headers.get('authorization') || ''
    });
    return visitor;
  };

  let identity: ReturnType<typeof resolveIdentity> | undefined;
  event.locals.getCurrentIdentity = async () => {
    if (identity === undefined) {
      identity = process.env.NODE_ENV === 'test' && process.env.OA_TEST_AUTH_BYPASS === '1'
        ? { uid: 826, username: 'catsco', displayName: 'catsco', role: 'admin', department: '', active: true }
        : resolveIdentity(await event.locals.getArtifactVisitor());
    }
    return identity;
  };

  const routeId = event.route.id || '';
  if (routeId.startsWith('/api/') && routeId !== '/api/whoami') {
    const current = await event.locals.getCurrentIdentity();
    if (!current) return json({ error: { code: 'UNAUTHORIZED', message: '请通过 Catsco 登录' } }, { status: 401 });
    if (current.role !== 'admin' && (!current.active || current.role === 'pending')) {
      return json({ error: { code: 'FORBIDDEN', message: '账户待管理员开通' } }, { status: 403 });
    }
    const method = event.request.method;
    const isOrderExport = routeId === '/api/orders/export' && !['admin', 'manager', 'owner'].includes(current.role);
    const isReimbursementAction = routeId.startsWith('/api/reimbursements') && (
      ['PATCH', 'DELETE'].includes(method) ||
      (method === 'POST' && (routeId.includes('/batch') || routeId.includes('/archive') || routeId.includes('/voucher'))) ||
      (method === 'GET' && routeId.endsWith('/export'))
    );
    if (isOrderExport) return json({ error: { code: 'FORBIDDEN', message: '没有订单导出权限' } }, { status: 403 });
    if (isReimbursementAction && !['admin', 'finance', 'owner'].includes(current.role)) {
      return json({ error: { code: 'FORBIDDEN', message: '没有财务操作权限' } }, { status: 403 });
    }
  }

  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  // Artifact 发布入口使用 sandbox iframe 内嵌工作台；不发送 X-Frame-Options 或 frame-ancestors，
  // 否则沙箱 iframe 的不透明来源会被浏览器拦截。应用没有本地会话，放开嵌入限制只影响展示层。
  response.headers.set('Referrer-Policy', 'same-origin');
  return response;
};

export const handleError: HandleServerError = ({ error }) => {
  console.error(error);
  return { message: '服务器内部错误' };
};
