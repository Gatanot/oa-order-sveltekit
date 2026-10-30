/**
 * 本机 OA 工具适配器：无密钥、无 Cookie、无浏览器身份。
 *
 * 只连接 http://127.0.0.1:<端口>/ 的本机代录入口；地址由宿主配置固定，
 * 绝不能来自模型参数、工具 schema 或聊天消息。请求不携带任何 Cookie、
 * Authorization、API Key、Origin 或 X-Forwarded-* 头，也不读取浏览器会话。
 *
 * 模型只能提交工具名与业务参数；工具名经前缀 + 允许列表精确映射到固定路由。
 * 身份工具 oa_entry_info 只返回本机入口模式与权限，不包含 AgentID、配置或员工信息。
 * 本文件无 SvelteKit 依赖，方便部署到宿主；放在 server/ 防止打包到前端。
 */

import { request as httpRequest } from 'node:http';

/** @typedef {{ name: string, description: string, inputSchema: Record<string, unknown> }} ToolDefinition */
/** @typedef {{ read: boolean, manage: boolean }} CatalogPermission */
/** @typedef {{ read: boolean, create: boolean }} OrderPermission */
/** @typedef {{ mode: string, permissions: { catalog: CatalogPermission, orders: OrderPermission } }} EntryIdentity */
/** @typedef {{ status: number, ok: boolean, json: () => Promise<unknown> }} TransportResponse */

const catalogNames = new Set(['list_sources', 'search_items', 'create_source', 'upsert_items']);
const orderNames = new Set(['search_orders', 'get_order', 'list_references', 'create_order', 'update_order', 'batch_create_orders']);
const catalogPrefix = 'oa_catalog_';
const ordersPrefix = 'oa_orders_';
const entryToolName = 'oa_entry_info';

const DEFAULT_APP_BASE_URL = 'http://127.0.0.1:3101/';
const LOOPBACK_HOST = '127.0.0.1';

const ME_PATH = 'api/ai/me';
const CATALOG_PATH = 'api/ai/catalog';
const ORDERS_PATH = 'api/ai/orders';

const invalidConfigMessage = '本机 OA 入口配置不正确：只允许 http://127.0.0.1:<端口>/，且不能包含凭据、查询串、片段或子路径。';
const unavailableMessage = '无法连接本机 OA 入口，请确认本机代录服务已启动。写入可能已完成，请先查询结果，勿盲目重复提交。';
const rejectedMessage = '本机 OA 入口未就绪或拒绝了请求，请确认本机代录服务已启动。';
const temporaryMessage = '本机 OA 入口暂时不可用，请稍后再试。写入可能已完成，请先查询结果，勿盲目重复提交。';

/**
 * 每个工具族（catalog/orders）有独立的固定子路径；
 * 前缀与允许列表必须同时匹配，模型提供的 name 不能改写路径或工具。
 */
const toolRoutes = [
  { prefix: catalogPrefix, names: catalogNames, path: CATALOG_PATH },
  { prefix: ordersPrefix, names: orderNames, path: ORDERS_PATH }
];

/** 本机入口自身信息：无参数，只返回 mode 与权限；不是员工，也不是任何 Agent。 */
const entryInfoTool = Object.freeze({
  name: entryToolName,
  description: '查询本机 OA 代录入口信息：运行模式 mode 与资料库/订单工具权限。这不代表任何浏览器登录员工，不接受任何参数。',
  inputSchema: Object.freeze({ type: 'object', properties: {}, additionalProperties: false })
});

export class OaToolHostError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] */
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'OaToolHostError';
    this.code = code;
    this.status = status;
  }
}

/**
 * appBaseUrl 是运维配置，不是模型参数；默认连接本机 3101 端口。
 * 本适配器不接受 apiKey 等额外配置，传入即视为配置错误。
 * @param {{ appBaseUrl?: string, fetchImpl?: typeof globalThis.fetch }} [options]
 */
export function createCatscoOaTools(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw invalidConfig();
  const { appBaseUrl = DEFAULT_APP_BASE_URL, fetchImpl, ...unsupported } = options;
  // 显式传入 apiKey/agentKey/token 等一律拒绝，避免任何“悄悄带上密钥”的用法。
  if (Object.keys(unsupported).length) throw invalidConfig();
  if (fetchImpl !== undefined && typeof fetchImpl !== 'function') throw invalidConfig();
  const base = parseBaseUrl(appBaseUrl);

  /**
   * 固定地址、固定请求头；不接受模型改路径、方法、重定向或请求头。
   * 不转发 Cookie/Authorization/API Key/Origin/X-Forwarded-*，也不使用自报身份头。
   * 不重试、不缓存响应。
   * @param {string} path @param {Record<string, unknown>} [body]
   */
  async function send(path, body) {
    if (![ME_PATH, CATALOG_PATH, ORDERS_PATH].includes(path)) {
      throw new OaToolHostError('UNKNOWN_TOOL', '未知 OA 工具');
    }
    const headers = new Headers({ Accept: 'application/json' });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    let response;
    try {
      response = fetchImpl
        ? await fetchImpl(new URL(path, base), {
          method: body === undefined ? 'GET' : 'POST',
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: 'error',
          cache: 'no-store',
          credentials: 'omit',
          signal: AbortSignal.timeout(15000)
        })
        // 默认不用全局 fetch：Node 会自动加 sec-fetch-mode 等浏览器头，本机入口会拒绝。
        : await sendViaHttp(base, path, body === undefined ? 'GET' : 'POST', headers, body === undefined ? undefined : JSON.stringify(body));
    } catch {
      // 不保留原始异常，避免 fetch 错误（可能含地址或请求细节）被宿主转发给模型。
      throw new OaToolHostError('OA_UNAVAILABLE', unavailableMessage, 503);
    }
    // 本机入口无认证；401/403 只说明入口未就绪或拒绝了请求，不回退任何会话。
    if (response.status === 401 || response.status === 403) {
      throw new OaToolHostError('OA_UNAVAILABLE', rejectedMessage, 503);
    }
    if (response.status >= 500) throw new OaToolHostError('OA_UNAVAILABLE', temporaryMessage, 503);
    /** @type {{ data?: unknown, error?: {code?: unknown, message?: unknown, path?: unknown} }} */
    let payload;
    try { payload = await response.json(); }
    catch { throw new OaToolHostError('INVALID_OA_RESPONSE', '本机 OA 响应格式不正确', 502); }
    if (!payload || typeof payload !== 'object') {
      throw new OaToolHostError('INVALID_OA_RESPONSE', '本机 OA 响应格式不正确', 502);
    }
    if (!response.ok) {
      // 仅传递本项目工具 API 的结构化业务错误，不暴露原始响应。
      const error = payload.error;
      return { error: {
        code: typeof error?.code === 'string' ? error.code : 'OA_REQUEST_FAILED',
        message: typeof error?.message === 'string' ? error.message : 'OA 请求失败',
        ...(typeof error?.path === 'string' ? { path: error.path } : {})
      } };
    }
    if (!Object.hasOwn(payload, 'data')) {
      throw new OaToolHostError('INVALID_OA_RESPONSE', '本机 OA 响应缺少数据', 502);
    }
    return { data: payload.data };
  }

  /**
   * 读取本机入口信息并消毒：只保留 mode 与权限布尔值，
   * 即使服务端多返回 agent_id/display_name/配置，也绝不会透传给模型。
   * @returns {Promise<EntryIdentity>}
   */
  async function readEntryIdentity() {
    const me = await send(ME_PATH);
    const data = /** @type {Record<string, unknown> | undefined} */ (me.data);
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.mode !== 'local_entry') {
      throw new OaToolHostError('OA_UNAVAILABLE', rejectedMessage, 503);
    }
    const permissions = data.permissions && typeof data.permissions === 'object'
      ? /** @type {Record<string, unknown>} */ (data.permissions)
      : {};
    return {
      mode: 'local_entry',
      permissions: {
        catalog: {
          read: permissionFlag(permissions.catalog, 'read'),
          manage: permissionFlag(permissions.catalog, 'manage')
        },
        orders: {
          read: permissionFlag(permissions.orders, 'read'),
          create: permissionFlag(permissions.orders, 'create')
        }
      }
    };
  }

  /** @returns {Promise<ToolDefinition[]>} */
  async function listTools() {
    const identity = await readEntryIdentity();
    /** @type {ToolDefinition[]} */
    const tools = [{
      name: entryInfoTool.name,
      description: entryInfoTool.description,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    }];
    // 权限互相独立：缺少 catalog 权限不会阻止加载 orders 清单，反之亦然。
    if (identity.permissions.catalog.read) {
      appendManifestTools(tools, await send(CATALOG_PATH), catalogNames, catalogPrefix);
    }
    if (identity.permissions.orders.read) {
      // 创建类工具需要额外 create 权限；其余工具由服务端 manifest 决定。
      appendManifestTools(
        tools,
        await send(ORDERS_PATH),
        orderNames,
        ordersPrefix,
        (name) => !needsCreate(name) || identity.permissions.orders.create
      );
    }
    return tools;
  }

  /**
   * 只注册服务端 manifest 中、且属于本族允许列表的工具，并统一加前缀；
   * schema 中的认证类字段（cookie/token/apiKey/session 等）一律剔除。
   * @param {ToolDefinition[]} tools @param {{ data?: unknown }} result
   * @param {Set<string>} names @param {string} prefix @param {(name: string) => boolean} [isEnabled]
   */
  function appendManifestTools(tools, result, names, prefix, isEnabled = () => true) {
    const manifest = /** @type {{ tools?: unknown } | undefined} */ (result.data);
    if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.tools)) {
      throw new OaToolHostError('INVALID_OA_RESPONSE', '本机 OA 工具定义格式不正确', 502);
    }
    for (const candidate of manifest.tools) {
      if (!candidate || typeof candidate !== 'object') continue;
      const tool = /** @type {{ name?: unknown, description?: unknown, inputSchema?: unknown }} */ (candidate);
      if (typeof tool.name !== 'string' || !names.has(tool.name) || !isEnabled(tool.name)) continue;
      tools.push({
        name: `${prefix}${tool.name}`,
        description: typeof tool.description === 'string' ? tool.description : '',
        inputSchema: sanitizeSchema(tool.inputSchema)
      });
    }
  }

  /**
   * 模型只提供 name 和 args；没有第三个 context 参数，也没有 Cookie 或浏览器会话。
   * 工具列表不构成授权，入口每次重新校验本机来源与工具名。
   * @param {string} name @param {unknown} args
   */
  async function execute(name, args) {
    if (typeof name !== 'string' || !name) throw new OaToolHostError('UNKNOWN_TOOL', '未知 OA 工具');
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw new OaToolHostError('VALIDATION_ERROR', '工具参数必须是 JSON 对象');
    }
    if (name === entryToolName) {
      if (Object.keys(args).length) {
        throw new OaToolHostError('VALIDATION_ERROR', '入口信息由本机配置确定，不接受任何参数');
      }
      return { data: await readEntryIdentity() };
    }
    // 前缀 + 允许列表精确映射到固定子路径；不使用模型参数拼接 URL 或工具名。
    for (const route of toolRoutes) {
      if (!name.startsWith(route.prefix)) continue;
      const tool = name.slice(route.prefix.length);
      if (!route.names.has(tool)) break;
      // arguments 原样转交：即使模型塞入 apiKey/token/cookie 等字段，也只进入 JSON body，
      // 不会变成请求头、URL、Cookie 或会话；由本机入口严格校验业务字段。
      return send(route.path, { tool, arguments: args });
    }
    throw new OaToolHostError('UNKNOWN_TOOL', '未知 OA 工具');
  }

  return { listTools, execute };
}

/**
 * 读取单个权限布尔值：只认 true，其余一律 false；不复制任何额外字段。
 * @param {unknown} value @param {string} key
 */
function permissionFlag(value, key) {
  if (value === true) return true;
  const source = value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
  return source[key] === true;
}

/** @param {string} name */
function needsCreate(name) {
  return name === 'create_order' || name === 'batch_create_orders';
}

/**
 * 认证类字段名：整段匹配 cookie/authorization/token/apiKey/session 等。
 * created_by_uid / created_by_name 是业务归属字段，不受影响。
 */
const credentialFieldPattern = /^(?:cookie|cookies|authorization|auth|token|access_?token|refresh_?token|api_?key|apikey|agent_?id|agent_?key|uid|user_?uid|secret|password|passwd|session|credential|credentials|header|headers|context)$/i;
const credentialPrefixPattern = /^(?:x[-_]?)?(?:oa[-_]?)?(?:auth|api[-_]?key|agent[-_]?key|cookie|session|token|secret|password)/i;

/**
 * 默认传输：node:http，只发送 Accept/Content-Type，绝不发送 Cookie、Authorization、
 * API Key、Origin、Referer、X-Forwarded-* 或浏览器 Fetch metadata。
 * 返回与 Response 兼容的最小形状供 send() 复用。
 * @param {URL} base @param {string} path @param {string} method @param {Headers} headers @param {string} [body]
 * @returns {Promise<TransportResponse>}
 */
function sendViaHttp(base, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const outgoing = {
      Accept: headers.get('accept') ?? 'application/json',
      ...(body === undefined ? {} : {
        'Content-Type': headers.get('content-type') ?? 'application/json',
        'Content-Length': String(Buffer.byteLength(body))
      })
    };
    const req = httpRequest({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: outgoing
    }, (res) => {
      /** @type {Buffer[]} */
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode ?? 0,
          ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
          json: async () => JSON.parse(text)
        });
      });
      res.on('error', reject);
    });
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

/** @param {unknown} key */
function isCredentialField(key) {
  const text = typeof key === 'string' ? key : String(key);
  return credentialFieldPattern.test(text) || credentialPrefixPattern.test(text.replace(/[^a-z0-9_-]/gi, ''));
}

/**
 * 只保留 JSON Schema 业务字段，强制 object 类型并剔除认证类属性。
 * @param {unknown} schema
 */
function sanitizeSchema(schema) {
  const source = schema && typeof schema === 'object' && !Array.isArray(schema)
    ? /** @type {Record<string, unknown>} */ (schema)
    : {};
  const sourceProperties = source.properties && typeof source.properties === 'object' && !Array.isArray(source.properties)
    ? /** @type {Record<string, unknown>} */ (source.properties)
    : {};
  /** @type {Record<string, unknown>} */
  const properties = {};
  for (const [key, value] of Object.entries(sourceProperties)) {
    if (isCredentialField(key)) continue;
    properties[key] = value;
  }
  const required = Array.isArray(source.required)
    ? source.required.filter((key) => typeof key === 'string' && Object.hasOwn(properties, key))
    : [];
  return {
    type: 'object',
    ...(typeof source.description === 'string' ? { description: source.description } : {}),
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false
  };
}

/** 配置错误：只返回通用信息，不回显任何被拒绝的配置值。 */
function invalidConfig() {
  return new OaToolHostError('INVALID_HOST_CONFIG', invalidConfigMessage, 400);
}

/**
 * 固定 OA 本机入口根地址：只能是 http://127.0.0.1:<端口>/。
 * 拒绝远程/非 loopback 主机、HTTPS、凭据、查询串、片段、子路径与缺省端口。
 * @param {unknown} appBaseUrl
 */
function parseBaseUrl(appBaseUrl) {
  if (typeof appBaseUrl !== 'string' || !appBaseUrl || /\s/.test(appBaseUrl)) throw invalidConfig();
  let base;
  try {
    base = new URL(appBaseUrl.endsWith('/') ? appBaseUrl : `${appBaseUrl}/`);
  } catch {
    throw invalidConfig();
  }
  if (base.protocol !== 'http:') throw invalidConfig();
  // 只允许 IPv4 loopback：服务默认仅监听 127.0.0.1，localhost 可能解析到 ::1。
  if (base.hostname !== LOOPBACK_HOST) throw invalidConfig();
  if (!base.port) throw invalidConfig();
  const port = Number(base.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalidConfig();
  if (base.username || base.password || base.search || base.hash) throw invalidConfig();
  // 不接受任何应用子路径，根路径必须正好是 /。
  if (base.pathname !== '/') throw invalidConfig();
  return new URL(`http://${LOOPBACK_HOST}:${port}/`);
}
