/**
 * 供 Catsco 可信服务端/工具宿主使用的「服务 Agent」适配器，不是模型可执行的独立 CLI。
 *
 * 接入身份是运维在服务端配置里固定的 OA 服务 Agent：appBaseUrl 与 apiKey 只能由宿主的
 * 服务端配置注入，绝不能来自模型参数、工具 schema 或聊天消息。请求只携带
 * X-OA-Agent-Key（刻意不用 Authorization，避免被平台网关当作终端用户凭据吞掉），
 * 不转发 Cookie/Authorization，也不读取任何浏览器会话。
 *
 * 模型只能提交工具名与业务参数；OA 每次重新校验 Agent 密钥、Agent 状态与权限。
 * apiKey 不进入工具定义，不写入错误信息，也不随原始异常向外泄露。
 * 本文件无 SvelteKit 依赖，方便部署到宿主；放在 server/ 防止打包到前端。
 */

/** @typedef {{ name: string, description: string, inputSchema: Record<string, unknown> }} ToolDefinition */
/** @typedef {{ catalog?: boolean | { read?: boolean, manage?: boolean }, orders?: boolean | { read?: boolean, create?: boolean } }} AgentPermissions */
/** @typedef {{ kind?: string, agent_id?: string, display_name?: string, permissions?: AgentPermissions }} AgentIdentity */

const MIN_API_KEY_LENGTH = 32;

const catalogNames = new Set(['list_sources', 'search_items', 'create_source', 'upsert_items']);
const orderNames = new Set(['search_orders', 'get_order', 'list_references', 'create_order', 'update_order', 'batch_create_orders']);
const catalogPrefix = 'oa_catalog_';
const ordersPrefix = 'oa_orders_';

const agentAuthMessage = 'OA 服务接入未通过验证：服务 Agent 密钥缺失、无效或已停用。请联系管理员配置服务接入，无需用户登录浏览器。';
const agentForbiddenMessage = '服务 Agent 没有该操作权限，或该接入已停用/待开通。';
const genericUnavailableMessage = '无法连接 OA，请稍后重试。写入可能已完成，请先查询结果，勿盲目重复提交。';

/**
 * 每个工具族（catalog/orders）有独立的固定子路径；
 * 前缀与允许列表必须同时匹配，模型提供的 name 不能改写路径或工具。
 */
const toolRoutes = [
  { prefix: catalogPrefix, names: catalogNames, path: 'api/ai/catalog' },
  { prefix: ordersPrefix, names: orderNames, path: 'api/ai/orders' }
];

/** 服务 Agent 自身信息工具：无参数，返回服务端配置的 Agent 身份与权限，不代表任何员工。 */
const agentInfoTool = Object.freeze({
  name: 'oa_agent_info',
  description: '查询当前 OA 服务 Agent 自身信息：agent_id、显示名称与资料库/订单工具权限。这是服务 Agent 身份，并非当前员工；不接受任何参数，也不涉及浏览器登录。',
  inputSchema: Object.freeze({ type: 'object', properties: {}, additionalProperties: false })
});

/**
 * 兼容旧宿主的别名，减少一次性 breaking；语义已改为「服务 Agent 信息」。
 * 若宿主可以升级，优先使用 oa_agent_info。
 */
const agentInfoAliasTool = Object.freeze({
  name: 'oa_current_user',
  description: '兼容别名，返回与 oa_agent_info 相同的服务 Agent 信息。注意：当前服务 Agent 并非当前员工，也不代表任何浏览器登录用户；不接受任何参数。',
  inputSchema: Object.freeze({ type: 'object', properties: {}, additionalProperties: false })
});

/** @type {Set<string>} */
const agentToolNames = new Set([agentInfoTool.name, agentInfoAliasTool.name]);

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
 * appBaseUrl 与 apiKey 都是运维配置，不是模型参数。
 * apiKey 只保留在闭包中，不写入工具定义、日志或错误对象。
 * @param {{ appBaseUrl: string, apiKey: string, fetchImpl?: typeof globalThis.fetch }} options
 */
export function createCatscoOaTools({ appBaseUrl, apiKey, fetchImpl = globalThis.fetch } = /** @type {any} */ ({})) {
  const base = parseBaseUrl(appBaseUrl);
  const agentKey = parseApiKey(apiKey);

  /**
   * 固定地址、固定请求头；不接受模型改路径、方法或请求头。
   * 不缓存响应、Agent 身份或工具列表。
   * @param {string} path @param {Record<string, unknown>} [body]
   */
  async function send(path, body) {
    const headers = new Headers({ Accept: 'application/json', 'X-OA-Agent-Key': agentKey });
    // 不转发 Cookie/Authorization/Origin/Host，也不使用 X-User-UID 等自报身份头。
    if (body) headers.set('content-type', 'application/json');
    let response;
    try {
      response = await fetchImpl(new URL(path, base), {
        method: body ? 'POST' : 'GET', headers,
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000)
      });
    } catch {
      // 不保留原始异常，避免 fetch 错误（可能含地址、请求头或密钥）被宿主转发给模型。
      throw new OaToolHostError('OA_UNAVAILABLE', genericUnavailableMessage, 503);
    }
    // 服务 Agent 校验失败时不回退到 Cookie/浏览器会话，也不提示用户登录。
    if (response.status === 401) throw new OaToolHostError('AGENT_AUTH_REQUIRED', agentAuthMessage, 401);
    if (response.status === 403) throw new OaToolHostError('FORBIDDEN', agentForbiddenMessage, 403);
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
   * 只读取服务 Agent 身份与权限，catalog/orders 清单各自独立按权限加载。
   * @returns {Promise<ToolDefinition[]>}
   */
  async function listTools() {
    const me = await send('api/ai/me');
    const identity = /** @type {AgentIdentity | undefined} */ (me.data);
    // 明确要求服务 Agent 身份，避免把员工会话或错误配置当成服务接入。
    if (!identity || typeof identity !== 'object' || identity.kind !== 'service_agent') {
      throw new OaToolHostError('AGENT_AUTH_REQUIRED', agentAuthMessage, 401);
    }
    // Agent 自身信息工具始终可用，且明确标注不是当前员工。
    /** @type {ToolDefinition[]} */
    const tools = [{ ...agentInfoTool }, { ...agentInfoAliasTool }];
    const permissions = identity.permissions ?? {};
    // 权限互相独立：缺少 catalog 权限不会阻止加载 orders 清单，反之亦然。
    if (hasReadPermission(permissions.catalog)) {
      const result = await send('api/ai/catalog');
      appendManifestTools(tools, result, catalogNames, catalogPrefix);
    }
    if (hasReadPermission(permissions.orders)) {
      const result = await send('api/ai/orders');
      // 创建类工具需要额外 create 权限；其余工具是否出现仍由服务端 manifest 按 Agent 状态决定。
      appendManifestTools(tools, result, orderNames, ordersPrefix, (name) => !needsCreate(name) || canCreate(permissions.orders));
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
   * 模型只提供 name 和 args；没有第三个 context 参数，也没有 Cookie 或浏览器会话。
   * 旧工具列表不构成授权，OA 每次重新验证服务 Agent 与权限。
   * @param {string} name @param {unknown} args
   */
  async function execute(name, args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw new OaToolHostError('VALIDATION_ERROR', '工具参数必须是 JSON 对象');
    }
    if (agentToolNames.has(name)) {
      if (Object.keys(args).length) throw new OaToolHostError('VALIDATION_ERROR', '服务 Agent 信息由服务端配置确定，不接受任何参数');
      return send('api/ai/me');
    }
    // 前缀+允许列表精确映射到固定子路径；不使用模型参数拼接 URL 或工具名。
    for (const route of toolRoutes) {
      if (!name.startsWith(route.prefix)) continue;
      const tool = name.slice(route.prefix.length);
      if (!route.names.has(tool)) break;
      // arguments 原样转交：即使模型塞入 apiKey/token/cookie 等字段，也只由 OA 服务端严格校验。
      return send(route.path, { tool, arguments: args });
    }
    throw new OaToolHostError('UNKNOWN_TOOL', '未知 OA 工具');
  }

  return { listTools, execute };
}

/** @param {unknown} value */
function hasReadPermission(value) {
  if (value === true) return true;
  return Boolean(value && typeof value === 'object' && /** @type {{read?: unknown}} */ (value).read === true);
}

/** @param {unknown} value */
function canCreate(value) {
  if (value === true) return true;
  return Boolean(value && typeof value === 'object' && /** @type {{create?: unknown}} */ (value).create === true);
}

/** @param {string} name */
function needsCreate(name) {
  return name === 'create_order' || name === 'batch_create_orders';
}

/**
 * 固定 OA 应用根地址：不允许内嵌凭据、查询串或片段；远程必须 HTTPS。
 * @param {unknown} appBaseUrl
 */
function parseBaseUrl(appBaseUrl) {
  let base;
  try {
    if (typeof appBaseUrl !== 'string' || !appBaseUrl) throw new Error('missing');
    base = new URL(appBaseUrl.endsWith('/') ? appBaseUrl : `${appBaseUrl}/`);
  } catch {
    throw new OaToolHostError('INVALID_HOST_CONFIG', 'OA 应用地址配置不正确');
  }
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new OaToolHostError('INVALID_HOST_CONFIG', 'OA 应用地址配置不正确');
  }
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
    throw new OaToolHostError('INVALID_HOST_CONFIG', '远程 OA 应用必须使用 HTTPS');
  }
  return base;
}

/**
 * 服务 Agent 密钥来自服务端配置，至少 32 字符且不含空白或换行（防头注入）。
 * 校验失败只返回通用错误，绝不回显密钥内容。
 * @param {unknown} apiKey
 */
function parseApiKey(apiKey) {
  if (
    typeof apiKey !== 'string'
    || apiKey.length < MIN_API_KEY_LENGTH
    || /\s/.test(apiKey)
    || /[\u0000-\u001f\u007f]/.test(apiKey)
  ) {
    throw new OaToolHostError('INVALID_HOST_CONFIG', 'OA 服务接入密钥配置不正确，请联系管理员检查服务端配置');
  }
  return apiKey;
}
