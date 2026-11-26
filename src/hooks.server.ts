import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { json, type Handle, type HandleServerError } from '@sveltejs/kit';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { getArtifactVisitor } from '$lib/server/artifact-visitor';
import { ADMIN_UID, isAdminUid, canUseReimbursementReview, getAdminExtraIdentity, orderExportRoles, reimbursementActionRoles, resolveActingIdentity, resolveIdentity, hasAnyRole } from '$lib/server/identity';
import type { CurrentIdentity } from '$lib/server/identity';

const brotliCompressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

// 低于此体积的响应压缩收益不足，直接原文返回，避免无谓 CPU 开销。
const COMPRESS_MIN_BYTES = 1024;
// 动态 JSON/HTML 压缩质量：brotli q5 约为体积/耗时的平衡点；静态资源仍由 adapter 的预压缩文件提供。
const BROTLI_QUALITY = 5;
const GZIP_LEVEL = 6;
const COMPRESSIBLE_TYPE = /^(?:text\/|application\/(?:json|javascript|xml|x-www-form-urlencoded|manifest\+json|ld\+json)|image\/svg\+xml)/i;

/** 按 RFC 9110 q 值选择可用的压缩算法，优先 brotli。 */
function negotiateEncoding(header: string | null): 'br' | 'gzip' | null {
  if (!header) return null;
  const accepted = new Map<string, number>();
  for (const part of header.toLowerCase().split(',')) {
    const [token, ...params] = part.trim().split(';');
    if (!token) continue;
    let quality = 1;
    for (const param of params) {
      const match = param.trim().match(/^q=([0-9.]+)$/);
      if (match) {
        const parsed = Number(match[1]);
        quality = Number.isFinite(parsed) ? parsed : 0;
      }
    }
    accepted.set(token.trim(), quality);
  }
  const br = accepted.get('br') ?? accepted.get('*') ?? 0;
  const gz = accepted.get('gzip') ?? accepted.get('*') ?? 0;
  if (br > 0 && br >= gz) return 'br';
  if (gz > 0) return 'gzip';
  return null;
}

/**
 * 给 SSR HTML 和 /api JSON 动态响应补上压缩。
 *
 * 静态资源由 adapter-node 的 sirv 按 .br/.gz 预压缩文件下发，不经过 hooks，因此这里不会重复压缩。
 * 必须在 hooks 中做，而不是改启动脚本，这样无论用 `node build`、反向代理还是平台入口启动都生效。
 */
async function compressResponse(request: Request, response: Response): Promise<Response> {
  if (request.method !== 'GET') return response;
  if (response.status < 200 || response.status === 204 || response.status === 304) return response;
  if (response.body === null || response.headers.has('content-encoding')) return response;
  if (response.headers.get('cache-control')?.toLowerCase().includes('no-transform')) return response;
  const contentType = response.headers.get('content-type') || '';
  if (!COMPRESSIBLE_TYPE.test(contentType)) return response;
  const encoding = negotiateEncoding(request.headers.get('accept-encoding'));
  if (!encoding) return response;

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > 0 && declaredLength < COMPRESS_MIN_BYTES) return response;

  const raw = Buffer.from(await response.arrayBuffer());
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  // 内容被重新编码后原 ETag 不再匹配，避免缓存/条件请求拿到错误结果。
  headers.delete('etag');

  if (raw.byteLength < COMPRESS_MIN_BYTES) {
    return new Response(raw, { status: response.status, statusText: response.statusText, headers });
  }

  const compressed = encoding === 'br'
    ? await brotliCompressAsync(raw, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
          [constants.BROTLI_PARAM_SIZE_HINT]: raw.byteLength
        }
      })
    : await gzipAsync(raw, { level: GZIP_LEVEL });

  headers.set('Content-Encoding', encoding);
  headers.set('Content-Length', String(compressed.byteLength));
  headers.append('Vary', 'Accept-Encoding');
  return new Response(compressed, { status: response.status, statusText: response.statusText, headers });
}

// 仅供 smoke test 使用：在测试环境下可指定一个固定的 Catsco UID，以便验证非管理员员工的权限。
function testBypassIdentity(): CurrentIdentity | null {
  const uid = Number(env.OA_TEST_UID || String(ADMIN_UID));
  if (isAdminUid(uid)) {
    const username = uid === ADMIN_UID ? 'catsco' : `admin${uid}`;
    return { uid, username, displayName: username, role: 'admin', department: '', active: true };
  }
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
        const extra = base?.role === 'admin' ? getAdminExtraIdentity(base.uid) : null;
        identity = base && extra ? { ...base, role: extra.role, displayName: `${base.displayName}（${extra.role}）` } : base;
      } else {
        identity = resolveActingIdentity(await event.locals.getArtifactVisitor());
      }
    }
    return identity;
  };

  const routeId = event.route.id || '';
  // 本机代录只在独立 loopback 进程提供。网页即使由本机代理转发，也不能进入代录通道。
  // 不依赖 remoteAddress 或 X-Forwarded-* 判断，以免 Artifact 连接器的本机来源造成误放行。
  if (event.url.pathname === '/api/ai' || event.url.pathname.startsWith('/api/ai/')) {
    return json({ error: { code: 'LOCAL_ENTRY_ONLY', message: '此入口已移至独立本机代录服务，网页不提供代录通道' } }, { status: 410, headers: { 'Cache-Control': 'no-store' } });
  }
  if (routeId.startsWith('/api/') && routeId !== '/api/whoami') {
    const current = await event.locals.getCurrentIdentity();
    if (!current) return json({ error: { code: 'UNAUTHORIZED', message: '请通过 Catsco 登录' } }, { status: 401 });
    if (current.role !== 'admin' && (!current.active || current.role === 'pending')) {
      return json({ error: { code: 'FORBIDDEN', message: '账户待管理员开通或已停用' } }, { status: 403 });
    }
    const method = event.request.method;
    const isOrderExport = routeId === '/api/orders/export' && !hasAnyRole(current, orderExportRoles);
    // 批量审核允许部门配置的审核人使用；单据生成/归档/导出仍限财务相关角色。
    const isReimbursementBatch = method === 'POST' && routeId === '/api/reimbursements/batch';
    const isReimbursementFinanceAction = routeId.startsWith('/api/reimbursements') && (
      (method === 'POST' && (routeId.includes('/archive') || routeId.includes('/voucher'))) ||
      (method === 'GET' && routeId.endsWith('/export'))
    );
    if (isOrderExport) return json({ error: { code: 'FORBIDDEN', message: '没有订单导出权限' } }, { status: 403 });
    if (isReimbursementBatch && !canUseReimbursementReview(current)) {
      return json({ error: { code: 'FORBIDDEN', message: '没有报销审核权限' } }, { status: 403 });
    }
    if (isReimbursementFinanceAction && !hasAnyRole(current, reimbursementActionRoles)) {
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
  return compressResponse(event.request, response);
};

export const handleError: HandleServerError = ({ error }) => {
  console.error(error);
  return { message: '服务器内部错误' };
};
