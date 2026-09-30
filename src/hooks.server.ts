import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { json, type Handle, type HandleServerError } from '@sveltejs/kit';
import { getArtifactVisitor } from '$lib/server/artifact-visitor';
import { ADMIN_UID, getAdminExtraIdentity, orderExportRoles, reimbursementActionRoles, resolveActingIdentity, resolveIdentity, hasAnyRole } from '$lib/server/identity';
import type { CurrentIdentity } from '$lib/server/identity';

// 仅供 smoke test 使用：在测试环境下可指定一个固定的 Catsco UID，以便验证非管理员员工的权限。
function testBypassIdentity(): CurrentIdentity | null {
  const uid = Number(env.OA_TEST_UID || String(ADMIN_UID));
  if (uid === ADMIN_UID) return { uid, username: 'catsco', displayName: 'catsco', role: 'admin', department: '', active: true };
  return resolveIdentity({
    status: 'authenticated',
    authenticated: true,
    viewer: { id: `test-${uid}`, uid, username: `test${uid}` },
    topicId: null
  });
}

export const handle: Handle = async ({ event, resolve }) => {
  const useTestIdentity = env.OA_TEST_AUTH_BYPASS === '1' && (dev || process.env.NODE_ENV === 'test');
  let visitor: ReturnType<typeof getArtifactVisitor> | undefined;
  event.locals.getArtifactVisitor = () => {
    visitor ??= getArtifactVisitor({
      cookie: event.request.headers.get('cookie') || '',
      authorization: event.request.headers.get('authorization') || ''
    });
    return visitor;
  };

  let adminIdentity: ReturnType<typeof resolveIdentity> | undefined;
  event.locals.getAdminIdentity = async () => {
    if (adminIdentity === undefined) {
      adminIdentity = useTestIdentity
        ? testBypassIdentity()
        : resolveIdentity(await event.locals.getArtifactVisitor());
    }
    return adminIdentity;
  };

  let identity: ReturnType<typeof resolveActingIdentity> | undefined;
  event.locals.getCurrentIdentity = async () => {
    if (identity === undefined) {
      if (useTestIdentity) {
        const base = testBypassIdentity();
        const extra = base?.role === 'admin' ? getAdminExtraIdentity() : null;
        identity = base && extra ? { ...base, role: extra.role, displayName: `${base.displayName}（${extra.role}）` } : base;
      } else {
        identity = resolveActingIdentity(await event.locals.getArtifactVisitor());
      }
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
    const isOrderExport = routeId === '/api/orders/export' && !hasAnyRole(current, orderExportRoles);
    const isReimbursementAction = routeId.startsWith('/api/reimbursements') && (
      (method === 'POST' && (routeId.includes('/batch') || routeId.includes('/archive') || routeId.includes('/voucher'))) ||
      (method === 'GET' && routeId.endsWith('/export'))
    );
    if (isOrderExport) return json({ error: { code: 'FORBIDDEN', message: '没有订单导出权限' } }, { status: 403 });
    if (isReimbursementAction && !hasAnyRole(current, reimbursementActionRoles)) {
      return json({ error: { code: 'FORBIDDEN', message: '没有财务操作权限' } }, { status: 403 });
    }
  }

  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  // Artifact 发布入口使用 sandbox iframe 内嵌工作台；不发送 X-Frame-Options 或 frame-ancestors，
  // 否则沙箱 iframe 的不透明来源会被浏览器拦截。应用没有本地会话，放开嵌入限制只影响展示层。
  response.headers.set('Referrer-Policy', 'same-origin');
  if (response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
    response.headers.set('Cache-Control', 'no-store');
  }
  return response;
};

export const handleError: HandleServerError = ({ error }) => {
  console.error(error);
  return { message: '服务器内部错误' };
};
