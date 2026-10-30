/**
 * 供 Catsco 可信服务端/工具宿主导入的适配器，不是模型可执行的独立 CLI。
 * createCatscoOaTools 的配置与每次调用的 currentUserRequest 必须由宿主注入，
 * 绝不能来自模型参数。只转发当前请求的 Cookie/Authorization 到固定 OA 应用，
 * 并由 OA -> Artifact 网关验证；不会信任 UID、角色或普通用户身份头。
 * 本文件无 SvelteKit 依赖，方便部署到宿主；放在 server/ 防止打包到前端。
 */

/** @typedef {{ name: string, description: string, inputSchema: Record<string, unknown> }} ToolDefinition */
/** @typedef {{ currentUserRequest: Request }} UserContext 当前用户请求，由可信宿主按调用注入，不进入模型 schema。 */

const catalogNames = new Set(['list_sources', 'search_items', 'create_source', 'upsert_items']);
const orderNames = new Set(['search_orders', 'get_order', 'list_references', 'create_order', 'update_order']);
const catalogPrefix = 'oa_catalog_';
const ordersPrefix = 'oa_orders_';
const loginMessage = '未取得当前 Catsco 用户的有效登录上下文，请登录并重新发起操作；不要向 AI 提供 Cookie、Token 或 UID 作为认证。';

/**
 * 每个工具族（catalog/orders）有独立的服务端 manifest 与固定子路径；
 * 前缀与允许列表必须同时匹配，模型提供的 name 不能改写路径或工具。
 */
const toolRoutes = [
  { prefix: catalogPrefix, names: catalogNames, path: 'api/ai/catalog' },
  { prefix: ordersPrefix, names: orderNames, path: 'api/ai/orders' }
];

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
 * appBaseUrl 为运维配置的固定 OA 应用根地址（包含 /<应用ID>/），不是模型参数。
 * currentUserRequest 必须包含网关可验证的用户会话，而不是 bot 的系统身份。
 * 若 Catsco 只提供 UID，不能在此生成身份；应由平台先提供受支持的会话传递机制。
 * @param {{ appBaseUrl: string, fetchImpl?: typeof globalThis.fetch }} options
 */
export function createCatscoOaTools({ appBaseUrl, fetchImpl = globalThis.fetch }) {
  const base = new URL(appBaseUrl.endsWith('/') ? appBaseUrl : `${appBaseUrl}/`);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new OaToolHostError('INVALID_HOST_CONFIG', 'OA 应用地址配置不正确');
  }
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
    throw new OaToolHostError('INVALID_HOST_CONFIG', '远程 OA 应用必须使用 HTTPS');
  }

  /**
   * 不缓存响应、用户、凭据或工具列表；不把上一次调用的身份留给下一个用户。
   * @param {UserContext} context @param {string} path @param {Record<string, unknown>} [body]
   */
  async function send(context, path, body) {
    const request = context?.currentUserRequest;
    if (!(request instanceof Request)) throw new OaToolHostError('LOGIN_REQUIRED', loginMessage, 401);
    const cookie = request.headers.get('cookie');
    const authorization = request.headers.get('authorization');
    if (!cookie && !authorization) throw new OaToolHostError('LOGIN_REQUIRED', loginMessage, 401);

    // 不转发任意请求头/Origin/Host，也不使用 X-User-UID 等自报身份。
    const headers = new Headers({ Accept: 'application/json' });
    if (cookie) headers.set('cookie', cookie);
    if (authorization) headers.set('authorization', authorization);
    if (body) headers.set('content-type', 'application/json');
    let response;
    try {
      response = await fetchImpl(new URL(path, base), {
        method: body ? 'POST' : 'GET', headers,
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000)
      });
    } catch {
      // 不返回原始异常，避免 fetch 错误中包含请求头、响应体或地址等宿主信息。
      throw new OaToolHostError('OA_UNAVAILABLE', '无法连接 OA，请稍后重试。写入可能已完成，请先查询结果，勿盲目重复提交。', 503);
    }
    if (response.status === 401) throw new OaToolHostError('LOGIN_REQUIRED', loginMessage, 401);
    if (response.status === 403) throw new OaToolHostError('FORBIDDEN', '当前用户没有该操作权限，或账号已停用/待开通。', 403);
    if (response.status >= 500) throw new OaToolHostError('OA_UNAVAILABLE', 'OA 暂时不可用，请稍后重试。', 503);
    /** @type {{ data?: unknown, error?: {code?: unknown, message?: unknown, path?: unknown} }} */
    let payload;
    try { payload = await response.json(); }
    catch { throw new OaToolHostError('INVALID_OA_RESPONSE', 'OA 响应格式不正确', 502); }
    if (!payload || typeof payload !== 'object') throw new OaToolHostError('INVALID_OA_RESPONSE', 'OA 响应格式不正确', 502);
    if (!response.ok) {
      // 仅传递本项目工具 API 的结构化业务错误，不暴露原始响应。
      const error = payload.error;
      return { error: {
        code: typeof error?.code === 'string' ? error.code : 'OA_REQUEST_FAILED',
        message: typeof error?.message === 'string' ? error.message : 'OA 请求失败',
        ...(typeof error?.path === 'string' ? { path: error.path } : {})
      } };
    }
    if (!Object.hasOwn(payload, 'data')) throw new OaToolHostError('INVALID_OA_RESPONSE', 'OA 响应缺少数据', 502);
    return { data: payload.data };
  }

  /**
   * 宿主在可信执行环境中按当前会话获取可注册工具，不把 context 交给模型。
   * @param {UserContext} context
   * @returns {Promise<ToolDefinition[]>}
   */
  async function listTools(context) {
    // 身份工具始终可注册；资料库/订单 manifest 按各自权限分别加载。
    const me = await send(context, 'api/ai/me');
    const identity = /** @type {{permissions?: {catalog?: {read?: boolean}, orders?: {read?: boolean, create?: boolean}}} | undefined} */ (me.data);
    /** @type {ToolDefinition[]} */
    const tools = [{
      name: 'oa_current_user',
      description: '查询本次调用对应的 Catsco 当前登录用户、OA 角色、资料库与订单权限。不接受身份参数，不要求用户提供凭据。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    }];
    // catalog 与 orders 权限互相独立：缺少其中一个不会阻止加载另一个 manifest。
    if (identity?.permissions?.catalog?.read) {
      const result = await send(context, 'api/ai/catalog');
      appendManifestTools(tools, result, catalogNames, catalogPrefix);
    }
    const orders = /** @type {{read?: boolean, create?: boolean} | undefined} */ (identity?.permissions?.orders);
    if (orders?.read) {
      const result = await send(context, 'api/ai/orders');
      // create_order 需要额外创建权限；update_order 是否出现由服务端 manifest 按身份决定（参与者也可更新）。
      appendManifestTools(tools, result, orderNames, ordersPrefix, (name) => name !== 'create_order' || orders.create === true);
    }
    return tools;
  }

  /**
   * 只注册服务端 manifest 中、且属于本族允许列表的工具，并统一加前缀。
   * @param {ToolDefinition[]} tools @param {{ data?: unknown }} result
   * @param {Set<string>} names @param {string} prefix @param {(name: string) => boolean} [isEnabled]
   */
  function appendManifestTools(tools, result, names, prefix, isEnabled = () => true) {
    const manifest = /** @type {{ tools?: ToolDefinition[] } | undefined} */ (result.data);
    if (!Array.isArray(manifest?.tools)) throw new OaToolHostError('INVALID_OA_RESPONSE', 'OA 工具定义格式不正确', 502);
    for (const tool of manifest.tools) {
      if (!names.has(tool.name) || !isEnabled(tool.name)) continue;
      tools.push({ ...tool, name: `${prefix}${tool.name}` });
    }
  }

  /**
   * 模型仅提供 name 和 arguments；context 是宿主每次调用绑定的独立参数。
   * 旧工具列表不构成授权，OA 每次重新验证会话、员工状态和权限。
   * @param {string} name @param {unknown} args @param {UserContext} context
   */
  async function execute(name, args, context) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw new OaToolHostError('VALIDATION_ERROR', '工具参数必须是 JSON 对象');
    }
    if (name === 'oa_current_user') {
      if (Object.keys(args).length) throw new OaToolHostError('VALIDATION_ERROR', '当前用户由会话确定，不接受任何身份参数');
      return send(context, 'api/ai/me');
    }
    // 前缀+允许列表精确映射到固定子路径；不使用模型参数拼接 URL 或工具名。
    for (const route of toolRoutes) {
      if (!name.startsWith(route.prefix)) continue;
      const tool = name.slice(route.prefix.length);
      if (!route.names.has(tool)) break;
      return send(context, route.path, { tool, arguments: args });
    }
    throw new OaToolHostError('UNKNOWN_TOOL', '未知 OA 工具');
  }

  return { listTools, execute };
}
