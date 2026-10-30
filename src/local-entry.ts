import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  OrderToolError,
  orderPermissions,
  orderTools,
  runOrderTool,
  type AiServiceIdentity
} from '$lib/server/ai-orders';
import { CatalogToolError, catalogTools, runCatalogTool } from '$lib/server/ai-catalog';

/**
 * 独立本机代录入口。
 *
 * 该进程不经过 SvelteKit hooks，不读取员工 Cookie，也没有共享密钥。它只接受
 * 来自 loopback 的显式 CLI/本机客户端请求；请勿放在反向代理或 Artifact 发布之后。
 */

const LOOPBACK_ADDRESS = '127.0.0.1';
const DEFAULT_PORT = 3101;
const MAX_BODY_BYTES = 1024 * 1024;

const ME_PATH = '/api/ai/me';
const ORDERS_PATH = '/api/ai/orders';
const CATALOG_PATH = '/api/ai/catalog';

const identity: AiServiceIdentity = {
  kind: 'local_entry',
  uid: -1,
  username: '',
  displayName: '',
  role: 'admin',
  department: '',
  active: true
};

class RequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly path?: string
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

function readPort(): number {
  const raw = process.env.OA_LOCAL_PORT;
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;
  if (!/^\d{1,5}$/.test(raw.trim())) {
    throw new Error('OA_LOCAL_PORT 必须是 0–65535 的整数');
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('OA_LOCAL_PORT 必须是 0–65535 的整数');
  }
  return port;
}

function isLoopbackRemote(address: string | undefined): boolean {
  if (!address) return false;
  // Linux/Windows 上 IPv4 连接可能表现为 IPv4-mapped IPv6。
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1'].includes(address.toLowerCase());
}

function allowedHosts(actualPort: number): Set<string> {
  return new Set([
    `127.0.0.1:${actualPort}`,
    `localhost:${actualPort}`,
    `[::1]:${actualPort}`
  ]);
}

/**
 * 这里只做本机边界校验：远程地址、Host（防 DNS rebinding）、浏览器来源
 *（Origin/Fetch metadata）和转发头。任何一项不符合都直接 403。
 */
function assertLocalRequest(req: IncomingMessage, actualPort: number): void {
  if (!isLoopbackRemote(req.socket.remoteAddress)) {
    throw new RequestError(403, 'FORBIDDEN', '仅允许本机 loopback 访问');
  }

  const host = req.headers.host;
  if (typeof host !== 'string' || !allowedHosts(actualPort).has(host.toLowerCase())) {
    throw new RequestError(403, 'FORBIDDEN', 'Host 不是本机入口允许的地址');
  }

  // 带 Origin 的请求全部拒绝，包括 Origin: null；不提供任何 CORS 响应。
  if (Object.hasOwn(req.headers, 'origin')) {
    throw new RequestError(403, 'FORBIDDEN', '本机入口不接受浏览器 Origin 请求');
  }

  for (const name of Object.keys(req.headers)) {
    const lower = name.toLowerCase();
    // Fetch metadata 是浏览器发起的明确信号；CLI/本机客户端不应发送这些头。
    if (lower.startsWith('sec-fetch-') || lower === 'sec-purpose' || lower === 'purpose') {
      throw new RequestError(403, 'FORBIDDEN', '本机入口不接受浏览器 Fetch metadata');
    }
    // 固定本机 endpoint，不接受任何代理转发链。
    if (
      lower === 'forwarded' ||
      lower.startsWith('forwarded-') ||
      lower.startsWith('x-forwarded-') ||
      lower === 'x-real-ip' ||
      lower === 'via' ||
      lower === 'x-via'
    ) {
      throw new RequestError(403, 'FORBIDDEN', '本机入口不接受转发请求头');
    }
  }
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {}
): void {
  if (res.writableEnded || res.destroyed) return;
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(text)),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extraHeaders
  });
  res.end(text);
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  path?: string
): void {
  sendJson(
    res,
    status,
    { error: { code, message, ...(path ? { path } : {}) } },
    status === 405 ? { Allow: 'GET, POST' } : {}
  );
}

/** 按流实际字节数限制请求体，不信任 Content-Length。 */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = req.headers['content-type'];
  const mediaType = typeof contentType === 'string' ? contentType.split(';', 1)[0].trim().toLowerCase() : '';
  if (mediaType !== 'application/json') {
    throw new RequestError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type 必须为 application/json');
  }

  const encoding = req.headers['content-encoding'];
  if (encoding !== undefined && encoding.toLowerCase() !== 'identity') {
    throw new RequestError(415, 'UNSUPPORTED_MEDIA_TYPE', '不接受压缩请求体');
  }

  const declared = req.headers['content-length'];
  if (declared !== undefined) {
    if (typeof declared !== 'string' || !/^\d+$/.test(declared)) {
      throw new RequestError(400, 'INVALID_CONTENT_LENGTH', 'Content-Length 无效');
    }
    if (Number(declared) > MAX_BODY_BYTES) {
      throw new RequestError(413, 'REQUEST_TOO_LARGE', '请求体不能超过 1 MiB');
    }
  }

  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const fail = (error: RequestError) => {
      if (settled) return;
      settled = true;
      req.pause();
      reject(error);
    };

    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > MAX_BODY_BYTES) {
        chunks.length = 0;
        fail(new RequestError(413, 'REQUEST_TOO_LARGE', '请求体不能超过 1 MiB'));
        return;
      }
      chunks.push(buffer);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (total === 0) {
        reject(new RequestError(400, 'INVALID_JSON', '请求体不能为空'));
        return;
      }
      let value: unknown;
      try {
        value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        reject(new RequestError(400, 'INVALID_JSON', '请求体必须是有效 JSON'));
        return;
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        reject(new RequestError(400, 'INVALID_REQUEST', '请求体必须是 JSON 对象'));
        return;
      }
      resolve(value as Record<string, unknown>);
    });

    req.on('error', () => fail(new RequestError(400, 'INVALID_BODY', '请求体读取失败')));
    req.on('aborted', () => fail(new RequestError(400, 'INVALID_BODY', '请求体读取失败')));
  });
}

function ordersManifest() {
  const permissions = orderPermissions(identity);
  return {
    version: 3,
    mode: 'local_entry',
    description:
      '本机代录订单工具。只通过 loopback 访问，不依赖网页登录态或员工 Cookie。创建/批量创建必须用 order.created_by_uid 指定归属员工（已开通在职，姓名取自员工档案）；也可更新归属。所有金额为人民币元字符串；写入默认预览；不开放删除、结款或状态变更。',
    permissions,
    tools: orderTools.filter(
      (tool) => (tool.name !== 'create_order' && tool.name !== 'batch_create_orders') || permissions.create
    )
  };
}

function catalogManifest() {
  return {
    version: 3,
    mode: 'local_entry',
    description:
      '本机代录报价/成本资料库工具。只通过 loopback 访问，不依赖网页登录态或员工 Cookie。dry_run 默认 true；false 为实际提交。',
    request: { tool: '工具名称', arguments: '符合 inputSchema 的 JSON 对象' },
    currency: 'CNY',
    money_unit: 'yuan',
    tools: catalogTools
  };
}

function validateToolRequest(body: Record<string, unknown>): { tool: string; arguments: unknown } {
  for (const key of Object.keys(body)) {
    if (key !== 'tool' && key !== 'arguments') {
      throw new RequestError(400, 'VALIDATION_ERROR', '不支持的请求字段', key);
    }
  }
  if (typeof body.tool !== 'string' || !body.tool.trim()) {
    throw new RequestError(400, 'VALIDATION_ERROR', '必须提供工具名称', 'tool');
  }
  return { tool: body.tool, arguments: body.arguments };
}

function isKnownPath(path: string): boolean {
  return path === ME_PATH || path === ORDERS_PATH || path === CATALOG_PATH;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, actualPort: number): Promise<void> {
  try {
    assertLocalRequest(req, actualPort);

    const rawUrl = req.url || '';
    // 固定路径：不解析、不规范化、不接受 query、绝对 URI 或额外路径段。
    if (rawUrl.includes('?') || !isKnownPath(rawUrl)) {
      throw new RequestError(404, 'NOT_FOUND', '接口不存在');
    }
    const path = rawUrl;
    const method = req.method || '';

    if (method !== 'GET' && method !== 'POST') {
      if (isKnownPath(path)) {
        throw new RequestError(405, 'METHOD_NOT_ALLOWED', '仅支持 GET 和 POST');
      }
      throw new RequestError(404, 'NOT_FOUND', '接口不存在');
    }

    if (method === 'GET') {
      if (path === ME_PATH) {
        sendJson(res, 200, {
          data: {
            mode: 'local_entry',
            permissions: {
              catalog: { read: true, manage: true },
              orders: orderPermissions(identity)
            }
          }
        });
        return;
      }
      if (path === ORDERS_PATH) {
        sendJson(res, 200, { data: ordersManifest() });
        return;
      }
      if (path === CATALOG_PATH) {
        sendJson(res, 200, { data: catalogManifest() });
        return;
      }
      throw new RequestError(404, 'NOT_FOUND', '接口不存在');
    }

    // POST 只接受工具调用；/api/ai/me 没有写接口。
    if (path !== ORDERS_PATH && path !== CATALOG_PATH) {
      throw new RequestError(405, 'METHOD_NOT_ALLOWED', '该接口仅支持 GET');
    }

    const body = await readJsonBody(req);
    const request = validateToolRequest(body);
    const data =
      path === ORDERS_PATH
        ? runOrderTool(request.tool, request.arguments, identity)
        : runCatalogTool(request.tool, request.arguments, identity);
    sendJson(res, 200, { data });
  } catch (reason) {
    if (reason instanceof OrderToolError || reason instanceof CatalogToolError) {
      sendError(res, reason.status, reason.code, reason.message, reason.path);
      return;
    }
    if (reason instanceof RequestError) {
      const tooLarge = reason.status === 413;
      if (tooLarge) {
        res.setHeader('Connection', 'close');
        res.once('finish', () => req.destroy());
      }
      sendError(res, reason.status, reason.code, reason.message, reason.path);
      return;
    }
    // 不向调用者暴露 SQL、文件路径、数据库路径或原始异常。
    console.error('local entry request failed', reason instanceof Error ? reason.name : 'UnknownError');
    sendError(res, 500, 'INTERNAL_ERROR', '本机代录操作失败，请稍后重试；提交结果不确定时先查询，勿盲目重试');
  }
}

function start(): void {
  const configuredPort = readPort();
  let actualPort = configuredPort;

  const server = createServer((req, res) => {
    void handleRequest(req, res, actualPort);
  });

  server.on('clientError', (_error, socket) => {
    if (socket.writable) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    } else {
      socket.destroy();
    }
  });

  server.on('error', (reason) => {
    const code = reason && typeof reason === 'object' && 'code' in reason ? String(reason.code) : 'UNKNOWN';
    console.error(`local entry server error: ${code}`);
    process.exitCode = 1;
  });

  server.listen(configuredPort, LOOPBACK_ADDRESS, () => {
    const address = server.address();
    if (address && typeof address === 'object') actualPort = address.port;
    // 端口 0 用于测试；这里只打印实际监听端口，不输出数据库或业务信息。
    console.log(`local entry listening on http://${LOOPBACK_ADDRESS}:${actualPort}`);
  });

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`local entry stopping (${signal})`);
    const force = setTimeout(() => {
      server.closeAllConnections?.();
      process.exit(1);
    }, 5_000);
    force.unref();
    server.close((error) => {
      clearTimeout(force);
      if (error) {
        console.error(`local entry close failed: ${error.name}`);
        process.exit(1);
      }
      process.exit(0);
    });
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

try {
  start();
} catch (reason) {
  console.error(reason instanceof Error ? reason.message : '本机代录入口启动失败');
  process.exitCode = 1;
}
