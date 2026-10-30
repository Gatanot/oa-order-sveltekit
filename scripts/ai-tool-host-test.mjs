/**
 * Host-adapter contract tests for createCatscoOaTools (service Agent mode).
 *
 * The adapter is configured only from server-side config: a fixed appBaseUrl plus a
 * service Agent apiKey. Every test uses an in-memory mock fetch; there is no real OA
 * service, no browser session, no cookies and no network access.
 *
 * Run with: node --test scripts/ai-tool-host-test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createCatscoOaTools, OaToolHostError } from '../src/lib/server/catsco-oa-tools.js';

const APP_BASE = 'https://oa.example.test/app42/';
const AGENT_KEY = 'svc-agent-key-0123456789abcdef0123456789abcdef';
const OTHER_KEY = 'another-agent-key-fedcba9876543210fedcba9876543210';
const AGENT_AUTH_MESSAGE = 'OA 服务接入未通过验证：服务 Agent 密钥缺失、无效或已停用。请联系管理员配置服务接入，无需用户登录浏览器。';

const adminIdentity = Object.freeze({
  kind: 'service_agent',
  agent_id: 'agent-oa-orders',
  display_name: 'OA 订单服务 Agent',
  permissions: {
    catalog: { read: true, manage: true },
    orders: { read: true, create: true }
  }
});

const ordersOnlyIdentity = Object.freeze({
  kind: 'service_agent',
  agent_id: 'agent-oa-orders-readonly',
  display_name: 'OA 订单只读 Agent',
  permissions: {
    orders: { read: true, create: true }
  }
});

const ordersNoCreateIdentity = Object.freeze({
  kind: 'service_agent',
  agent_id: 'agent-oa-orders-viewer',
  display_name: 'OA 订单查看 Agent',
  permissions: {
    orders: { read: true, create: false }
  }
});

const catalogOnlyIdentity = Object.freeze({
  kind: 'service_agent',
  agent_id: 'agent-oa-catalog',
  display_name: 'OA 资料库 Agent',
  permissions: {
    catalog: { read: true, manage: true }
  }
});

const noPermissionIdentity = Object.freeze({
  kind: 'service_agent',
  agent_id: 'agent-oa-empty',
  display_name: 'OA 空权限 Agent',
  permissions: {}
});

const catalogManifest = Object.freeze({
  version: 1,
  tools: [
    {
      name: 'list_sources',
      description: '列出资料库来源',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, additionalProperties: false }
    },
    {
      name: 'search_items',
      description: '搜索资料库条目',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, dry_run: { type: 'boolean' } },
        required: ['query'],
        additionalProperties: false
      }
    },
    {
      name: 'create_source',
      description: '创建资料库来源',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } }, additionalProperties: false }
    },
    {
      name: 'upsert_items',
      description: '写入资料库条目',
      inputSchema: { type: 'object', properties: { source_id: { type: 'string' }, items: { type: 'array' } }, additionalProperties: false }
    },
    // Must be filtered out: not part of the host's allow-list.
    {
      name: 'delete_everything',
      description: '危险且未授权的工具',
      inputSchema: { type: 'object', properties: { cookie: { type: 'string' } } }
    },
    {
      name: '../../api/ai/me',
      description: '路径注入工具',
      inputSchema: { type: 'object', properties: {} }
    }
  ]
});

const ordersManifest = Object.freeze({
  version: 1,
  description: '订单工具',
  tools: [
    {
      name: 'search_orders',
      description: '搜索订单',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, dry_run: { type: 'boolean' } },
        required: ['query'],
        additionalProperties: false
      }
    },
    {
      name: 'get_order',
      description: '读取订单详情',
      inputSchema: { type: 'object', properties: { order_id: { type: 'string' } }, required: ['order_id'], additionalProperties: false }
    },
    {
      name: 'list_references',
      description: '列出订单引用数据',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'create_order',
      description: '创建订单',
      inputSchema: {
        type: 'object',
        properties: { customer_name: { type: 'string' }, items: { type: 'array' } },
        required: ['customer_name'],
        additionalProperties: false
      }
    },
    {
      name: 'update_order',
      description: '更新订单',
      inputSchema: {
        type: 'object',
        properties: { order_id: { type: 'string' }, patch: { type: 'object' } },
        required: ['order_id'],
        additionalProperties: false
      }
    },
    {
      name: 'batch_create_orders',
      description: '批量代录订单',
      inputSchema: {
        type: 'object',
        properties: {
          orders: { type: 'array' },
          // 代录归属，不是认证字段：服务 Agent 代表某位员工录单时使用的业务归属。
          created_by_uid: { type: 'integer' },
          created_by_name: { type: 'string' },
          dry_run: { type: 'boolean' }
        },
        required: ['orders'],
        additionalProperties: false
      }
    },
    // Must be filtered out: unknown names, path injection, double prefixing.
    { name: 'delete_everything', description: '危险且未授权的订单工具', inputSchema: { type: 'object', properties: {} } },
    { name: '../../api/ai/me', description: '订单路径注入工具', inputSchema: { type: 'object', properties: {} } },
    { name: 'oa_orders_search_orders', description: '已被前缀命名的工具', inputSchema: { type: 'object', properties: {} } }
  ]
});

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

function pathOf(url) {
  return new URL(String(url)).pathname;
}

function defaultHandler(snapshot) {
  const { url, init } = snapshot;
  const pathname = pathOf(url);
  if (pathname.endsWith('/api/ai/me')) return jsonResponse({ data: adminIdentity });
  if (pathname.endsWith('/api/ai/catalog')) {
    if ((init.method ?? 'GET') === 'GET') return jsonResponse({ data: catalogManifest });
    const body = JSON.parse(init.body);
    return jsonResponse({ data: { surface: 'catalog', tool: body.tool, arguments: body.arguments } });
  }
  if (pathname.endsWith('/api/ai/orders')) {
    if ((init.method ?? 'GET') === 'GET') return jsonResponse({ data: ordersManifest });
    const body = JSON.parse(init.body);
    return jsonResponse({ data: { surface: 'orders', tool: body.tool, arguments: body.arguments } });
  }
  throw new Error(`unexpected mock URL: ${url}`);
}

/** Only the orders surface; catalog must never be requested. */
function ordersHandler(snapshot) {
  const { url, init } = snapshot;
  const pathname = pathOf(url);
  if (pathname.endsWith('/api/ai/me')) return jsonResponse({ data: ordersOnlyIdentity });
  if (pathname.endsWith('/api/ai/orders')) {
    if ((init.method ?? 'GET') === 'GET') return jsonResponse({ data: ordersManifest });
    const body = JSON.parse(init.body);
    return jsonResponse({ data: { surface: 'orders', tool: body.tool, arguments: body.arguments } });
  }
  throw new Error(`orders-only mock must not request ${url}`);
}

/** Only the catalog surface; orders must never be requested. */
function catalogHandler(snapshot) {
  const { url, init } = snapshot;
  const pathname = pathOf(url);
  if (pathname.endsWith('/api/ai/me')) return jsonResponse({ data: catalogOnlyIdentity });
  if (pathname.endsWith('/api/ai/catalog')) {
    if ((init.method ?? 'GET') === 'GET') return jsonResponse({ data: catalogManifest });
    const body = JSON.parse(init.body);
    return jsonResponse({ data: { surface: 'catalog', tool: body.tool, arguments: body.arguments } });
  }
  throw new Error(`catalog-only mock must not request ${url}`);
}

function recordingAdapter({ handler = defaultHandler, appBaseUrl = APP_BASE, apiKey = AGENT_KEY } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const snapshot = {
      url: url instanceof URL ? url.href : String(url),
      init,
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: init.body,
      redirect: init.redirect,
      cache: init.cache,
      signal: init.signal
    };
    calls.push(snapshot);
    return handler(snapshot);
  };
  return { adapter: createCatscoOaTools({ appBaseUrl, apiKey, fetchImpl }), calls };
}

function noFetchAdapter(options = {}) {
  let count = 0;
  const adapter = createCatscoOaTools({
    appBaseUrl: APP_BASE,
    apiKey: AGENT_KEY,
    ...options,
    fetchImpl: async () => {
      count += 1;
      throw new Error('fetch must not be called');
    }
  });
  return { adapter, fetchCount: () => count };
}

async function rejectsWith(promise, code, status) {
  let caught;
  await assert.rejects(promise, (reason) => {
    caught = reason;
    return reason instanceof OaToolHostError
      && reason.code === code
      && (status === undefined || reason.status === status);
  });
  return caught;
}

/** 认证类字段绝不能出现在工具 schema 中；created_by_uid 是业务归属，允许保留。 */
function assertNoCredentialSchemaLeak(tools) {
  const serialized = JSON.stringify(tools);
  assert.doesNotMatch(serialized, /cookie|authorization|bearer|x-oa-agent-key|api[_-]?key|access[_-]?token|session/i);
  assert.doesNotMatch(serialized, /currentUserRequest|userContext/i);
  assert.ok(!serialized.includes(AGENT_KEY), 'the configured apiKey must never appear in tool definitions');
  for (const tool of tools) {
    assert.equal(typeof tool.name, 'string');
    assert.equal(typeof tool.description, 'string');
    assert.equal(typeof tool.inputSchema, 'object');
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(!('context' in tool), 'host context must never be part of the tool definition');
    assert.ok(!('currentUserRequest' in tool), 'browser request must never be part of the tool definition');
  }
}

test('rejects unsafe base URLs or invalid service keys from config without echoing the key', () => {
  for (const appBaseUrl of [
    'http://oa.example.test/app42/',
    'ftp://oa.example.test/app42/',
    'https://user:password@oa.example.test/app42/',
    'https://oa.example.test/app42/?redirect=https://evil.test/',
    'https://oa.example.test/app42/#fragment',
    '',
    undefined
  ]) {
    assert.throws(
      () => createCatscoOaTools({ appBaseUrl, apiKey: AGENT_KEY, fetchImpl: async () => { throw new Error('unused'); } }),
      (error) => error instanceof OaToolHostError && error.code === 'INVALID_HOST_CONFIG' && error.status === 400,
      `expected base URL to be rejected: ${String(appBaseUrl)}`
    );
  }

  // Plain HTTP is tolerated only for local development hosts.
  for (const appBaseUrl of [
    'http://localhost:5173/app42/',
    'http://127.0.0.1:5173/app42/',
    'http://[::1]:5173/app42/'
  ]) {
    assert.doesNotThrow(() => createCatscoOaTools({ appBaseUrl, apiKey: AGENT_KEY, fetchImpl: async () => { throw new Error('unused'); } }));
  }

  const longSecret = `too-short-but-recognisable-${'k'.repeat(8)}`;
  const invalidKeys = [
    undefined,
    null,
    1234567890123456789012345678901234,
    '',
    'short-key',
    'x'.repeat(31),
    `${longSecret}\n`,
    `${'a'.repeat(16)} ${'b'.repeat(16)}`,
    ` ${'a'.repeat(32)}`
  ];
  for (const apiKey of invalidKeys) {
    assert.throws(
      () => createCatscoOaTools({ appBaseUrl: APP_BASE, apiKey, fetchImpl: async () => { throw new Error('unused'); } }),
      (error) => {
        assert.ok(error instanceof OaToolHostError);
        assert.equal(error.code, 'INVALID_HOST_CONFIG');
        assert.equal(error.status, 400);
        assert.match(error.message, /服务接入密钥配置不正确/);
        const text = `${error.message}\n${error.stack ?? ''}\n${JSON.stringify(error)}`;
        assert.ok(!text.includes('recognisable'), 'the rejected key must not be echoed');
        assert.ok(!text.includes('kkkkkkkk'), 'the rejected key must not be echoed');
        return true;
      },
      `expected apiKey to be rejected: ${String(apiKey)}`
    );
  }

  // Exactly 32 non-whitespace characters is the minimum accepted length.
  assert.doesNotThrow(() => createCatscoOaTools({
    appBaseUrl: APP_BASE,
    apiKey: 'k'.repeat(32),
    fetchImpl: async () => { throw new Error('unused'); }
  }));
});

test('listTools is service-Agent only: fixed URLs, X-OA-Agent-Key header, no cookie, no browser request', async () => {
  const { adapter, calls } = recordingAdapter();

  assert.equal(adapter.listTools.length, 0, 'listTools must not accept a user/browser context');
  const tools = await adapter.listTools();

  assert.deepEqual(tools.map((tool) => tool.name), [
    'oa_agent_info',
    'oa_current_user',
    'oa_catalog_list_sources',
    'oa_catalog_search_items',
    'oa_catalog_create_source',
    'oa_catalog_upsert_items',
    'oa_orders_search_orders',
    'oa_orders_get_order',
    'oa_orders_list_references',
    'oa_orders_create_order',
    'oa_orders_update_order',
    'oa_orders_batch_create_orders'
  ]);
  assertNoCredentialSchemaLeak(tools);
  // Unprefixed, double-prefixed and path-injection manifest entries must be dropped.
  assert.ok(!tools.some((tool) => tool.name === 'delete_everything'));
  assert.ok(!tools.some((tool) => tool.name.includes('/')));
  assert.ok(!tools.some((tool) => tool.name === 'oa_orders_oa_orders_search_orders'));
  // created_by_uid is business attribution for agent-entered orders, not authentication.
  const batch = tools.find((tool) => tool.name === 'oa_orders_batch_create_orders');
  assert.ok(batch.inputSchema.properties.created_by_uid, 'order schemas may carry created_by_uid attribution');
  assert.ok(batch.inputSchema.properties.created_by_name);

  assert.deepEqual(calls.map((call) => [pathOf(call.url), call.method]), [
    ['/app42/api/ai/me', 'GET'],
    ['/app42/api/ai/catalog', 'GET'],
    ['/app42/api/ai/orders', 'GET']
  ]);
  assert.deepEqual(calls.map((call) => call.url), [
    'https://oa.example.test/app42/api/ai/me',
    'https://oa.example.test/app42/api/ai/catalog',
    'https://oa.example.test/app42/api/ai/orders'
  ]);
  for (const call of calls) {
    assert.equal(new URL(call.url).search, '');
    assert.equal(call.method, 'GET');
    assert.equal(call.body, undefined);
    assert.equal(call.redirect, 'error');
    assert.equal(call.cache, 'no-store');
    assert.ok(call.signal instanceof AbortSignal);
    assert.equal(call.headers.get('x-oa-agent-key'), AGENT_KEY);
    assert.equal(call.headers.get('accept'), 'application/json');
    // The gateway must not see user credentials from a browser session.
    assert.equal(call.headers.get('cookie'), null);
    assert.equal(call.headers.get('authorization'), null, 'apiKey must not travel in Authorization');
    assert.equal(call.headers.get('x-user-uid'), null);
    assert.equal(call.headers.get('content-type'), null);
  }
});

test('oa_agent_info and the legacy oa_current_user alias return Agent identity and accept no arguments', async () => {
  const { adapter, calls } = recordingAdapter();

  for (const name of ['oa_agent_info', 'oa_current_user']) {
    const result = await adapter.execute(name, {});
    assert.deepEqual(result, { data: adminIdentity });
  }
  assert.deepEqual(calls.map((call) => [pathOf(call.url), call.method]), [
    ['/app42/api/ai/me', 'GET'],
    ['/app42/api/ai/me', 'GET']
  ]);

  // Descriptions must make the Agent ≠ employee distinction explicit for the model.
  const { adapter: fresh } = recordingAdapter();
  const tools = await fresh.listTools();
  const info = tools.find((tool) => tool.name === 'oa_agent_info');
  assert.match(info.description, /服务 Agent/);
  assert.match(info.description, /并非当前员工/);
  const alias = tools.find((tool) => tool.name === 'oa_current_user');
  assert.match(alias.description, /并非当前员工/);
  assert.deepEqual(alias.inputSchema, { type: 'object', properties: {}, additionalProperties: false });

  const before = calls.length;
  for (const args of [
    { uid: 'u-bob' },
    { userId: 'u-bob' },
    { cookie: 'session=bob' },
    { authorization: 'Bearer bob' },
    { token: 'bob-token' },
    { apiKey: OTHER_KEY },
    { currentUserRequest: { headers: { cookie: 'session=bob' } } }
  ]) {
    const error = await rejectsWith(adapter.execute('oa_agent_info', args), 'VALIDATION_ERROR', 400);
    assert.match(error.message, /不接受任何参数/);
  }
  assert.equal(calls.length, before, 'rejected arguments must never reach OA');
});

test('tool lists follow permissions independently: orders-only, catalog-only and no permissions', async () => {
  {
    const { adapter, calls } = recordingAdapter({ handler: ordersHandler });
    const tools = await adapter.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), [
      'oa_agent_info',
      'oa_current_user',
      'oa_orders_search_orders',
      'oa_orders_get_order',
      'oa_orders_list_references',
      'oa_orders_create_order',
      'oa_orders_update_order',
      'oa_orders_batch_create_orders'
    ]);
    assert.ok(tools.every((tool) => tool.name === 'oa_agent_info' || tool.name === 'oa_current_user' || tool.name.startsWith('oa_orders_')));
    assertNoCredentialSchemaLeak(tools);
    assert.deepEqual(calls.map((call) => [pathOf(call.url), call.method]), [
      ['/app42/api/ai/me', 'GET'],
      ['/app42/api/ai/orders', 'GET']
    ]);
  }

  {
    const { adapter, calls } = recordingAdapter({ handler: catalogHandler });
    const tools = await adapter.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), [
      'oa_agent_info',
      'oa_current_user',
      'oa_catalog_list_sources',
      'oa_catalog_search_items',
      'oa_catalog_create_source',
      'oa_catalog_upsert_items'
    ]);
    assert.deepEqual(calls.map((call) => [pathOf(call.url), call.method]), [
      ['/app42/api/ai/me', 'GET'],
      ['/app42/api/ai/catalog', 'GET']
    ]);
  }

  {
    const { adapter, calls } = recordingAdapter({
      handler: ({ url }) => (pathOf(url).endsWith('/api/ai/me')
        ? jsonResponse({ data: noPermissionIdentity })
        : jsonResponse({ error: { code: 'FORBIDDEN', message: 'no access' } }, 403))
    });
    const tools = await adapter.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), ['oa_agent_info', 'oa_current_user']);
    assert.equal(calls.length, 1, 'no permission means no manifest requests');
  }

  {
    // create:false keeps read tools but filters both write helpers.
    const { adapter } = recordingAdapter({
      handler: ({ url, init }) => {
        if (pathOf(url).endsWith('/api/ai/me')) return jsonResponse({ data: ordersNoCreateIdentity });
        if (pathOf(url).endsWith('/api/ai/orders') && init.method === 'GET') return jsonResponse({ data: ordersManifest });
        throw new Error(`unexpected URL ${url}`);
      }
    });
    const tools = await adapter.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), [
      'oa_agent_info',
      'oa_current_user',
      'oa_orders_search_orders',
      'oa_orders_get_order',
      'oa_orders_list_references',
      'oa_orders_update_order'
    ]);
  }
});

test('tool lists are not cached: permissions are re-read on every listTools call', async () => {
  let identity = noPermissionIdentity;
  const { adapter, calls } = recordingAdapter({
    handler: ({ url, init }) => {
      if (pathOf(url).endsWith('/api/ai/me')) return jsonResponse({ data: identity });
      if (pathOf(url).endsWith('/api/ai/orders') && init.method === 'GET') return jsonResponse({ data: ordersManifest });
      throw new Error(`unexpected URL ${url}`);
    }
  });

  assert.deepEqual((await adapter.listTools()).map((tool) => tool.name), ['oa_agent_info', 'oa_current_user']);
  identity = ordersOnlyIdentity;
  const later = await adapter.listTools();
  assert.ok(later.some((tool) => tool.name === 'oa_orders_batch_create_orders'));
  assert.equal(calls.filter((call) => pathOf(call.url).endsWith('/api/ai/me')).length, 2);
});

test('execute rejects unknown tools and malformed arguments before any fetch', async () => {
  const { adapter, fetchCount } = noFetchAdapter();

  for (const name of [
    'delete_everything',
    'oa_delete_everything',
    'oa_catalog_delete_everything',
    'oa_catalog_',
    'oa_catalog_../../api/ai/me',
    'api/ai/me',
    'oa_catalog_list_sources/../../me',
    'list_sources',
    'oa_order_search_orders',
    'oa_orders_delete_everything',
    'oa_orders_',
    'oa_orders_../../api/ai/me',
    'oa_orders_search_orders/../../me',
    'oa_orders_oa_orders_search_orders',
    'search_orders',
    'batch_create_orders',
    ''
  ]) {
    await rejectsWith(adapter.execute(name, {}), 'UNKNOWN_TOOL', 400);
  }

  for (const args of [undefined, null, [], 'query', 1, true]) {
    await rejectsWith(adapter.execute('oa_catalog_search_items', args), 'VALIDATION_ERROR', 400);
  }

  assert.equal(fetchCount(), 0);
});

test('execute has no context parameter: a legacy browser/cookie context is ignored and never forwarded', async () => {
  const { adapter, calls } = recordingAdapter();
  const legacyContext = {
    currentUserRequest: new Request('https://catsco.example.test/chat', {
      headers: { cookie: 'session=alice', authorization: 'Bearer alice-token', 'x-user-uid': 'u-alice' }
    })
  };

  assert.equal(adapter.execute.length, 2, 'execute(name, args) must not accept a per-user context');
  const result = await adapter.execute('oa_catalog_search_items', { query: '阀门' }, legacyContext);
  const legacyIdentity = await adapter.execute('oa_current_user', {}, legacyContext);

  assert.deepEqual(result, { data: { surface: 'catalog', tool: 'search_items', arguments: { query: '阀门' } } });
  assert.deepEqual(legacyIdentity, { data: adminIdentity });
  assert.equal(calls.length, 2);

  const [search, me] = calls;
  assert.equal(search.url, 'https://oa.example.test/app42/api/ai/catalog');
  assert.equal(search.method, 'POST');
  assert.equal(me.url, 'https://oa.example.test/app42/api/ai/me');
  for (const call of calls) {
    assert.equal(call.headers.get('x-oa-agent-key'), AGENT_KEY);
    assert.equal(call.headers.get('cookie'), null, 'browser cookies must never be forwarded');
    assert.equal(call.headers.get('authorization'), null, 'user Authorization must never be forwarded');
    assert.equal(call.headers.get('x-user-uid'), null);
  }
});

test('fixed URL/method/headers cannot be overridden by model arguments; args apiKey is only server-validated', async () => {
  const { adapter, calls } = recordingAdapter({ appBaseUrl: 'https://oa.example.test/app42' });
  const modelArguments = {
    query: '阀门',
    tool: 'create_source',
    path: '/api/ai/me',
    url: 'https://attacker.example/steal',
    appBaseUrl: 'https://attacker.example/',
    endpoint: '../../api/ai/me',
    method: 'DELETE',
    redirect: 'follow',
    headers: { cookie: 'session=attacker', 'x-oa-agent-key': OTHER_KEY },
    apiKey: OTHER_KEY,
    token: 'attacker-token'
  };

  const result = await adapter.execute('oa_catalog_search_items', modelArguments);

  assert.deepEqual(result, { data: { surface: 'catalog', tool: 'search_items', arguments: modelArguments } });
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.url, 'https://oa.example.test/app42/api/ai/catalog');
  assert.equal(new URL(call.url).origin, 'https://oa.example.test');
  assert.equal(new URL(call.url).search, '');
  assert.equal(new URL(call.url).pathname, '/app42/api/ai/catalog');
  assert.equal(call.method, 'POST');
  assert.equal(call.redirect, 'error');
  assert.equal(call.cache, 'no-store');
  assert.equal(call.headers.get('x-oa-agent-key'), AGENT_KEY, 'only the configured service key is used');
  assert.equal(call.headers.get('cookie'), null);
  assert.equal(call.headers.get('authorization'), null);
  const body = JSON.parse(call.body);
  assert.equal(body.tool, 'search_items', 'arguments cannot replace the selected tool');
  assert.deepEqual(body.arguments, modelArguments);
});

test('oa_orders_batch_create_orders maps to the fixed orders path with the configured Agent key', async () => {
  const { adapter, calls } = recordingAdapter();
  const batchArguments = {
    orders: [{ customer_name: '客户 A', items: [] }],
    created_by_uid: 1001,
    created_by_name: 'ai-exec',
    dry_run: true
  };

  const result = await adapter.execute('oa_orders_batch_create_orders', batchArguments);

  assert.deepEqual(result, { data: { surface: 'orders', tool: 'batch_create_orders', arguments: batchArguments } });
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.url, 'https://oa.example.test/app42/api/ai/orders');
  assert.equal(call.method, 'POST');
  assert.equal(call.redirect, 'error');
  assert.equal(call.cache, 'no-store');
  assert.equal(call.headers.get('x-oa-agent-key'), AGENT_KEY);
  assert.equal(call.headers.get('cookie'), null);
  assert.equal(call.headers.get('authorization'), null);
  assert.equal(call.headers.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(call.body), { tool: 'batch_create_orders', arguments: batchArguments });
});

test('OA 401 becomes AGENT_AUTH_REQUIRED with an administrator instruction, no login prompt and no cookie fallback', async () => {
  const secret = 'SUPER-SECRET-raw-gateway-detail';
  const { adapter, calls } = recordingAdapter({
    handler: () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: `send Cookie=${secret}` } }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    })
  });

  const listError = await rejectsWith(adapter.listTools(), 'AGENT_AUTH_REQUIRED', 401);
  const executeError = await rejectsWith(adapter.execute('oa_catalog_search_items', { query: 'x' }), 'AGENT_AUTH_REQUIRED', 401);

  for (const error of [listError, executeError]) {
    assert.equal(error.message, AGENT_AUTH_MESSAGE);
    assert.match(error.message, /管理员配置服务接入/);
    assert.match(error.message, /无需用户登录浏览器/);
    assert.doesNotMatch(error.message, /请登录|请提供|请输入|请发送|Cookie|Token|UID/i);
    assert.ok(!error.message.includes(secret));
    assert.ok(!String(error.stack).includes(secret));
  }
  // No retry, no fallback to any browser session: exactly one request per call.
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.headers.get('cookie'), null);
    assert.equal(call.headers.get('authorization'), null);
    assert.equal(call.headers.get('x-oa-agent-key'), AGENT_KEY);
  }
});

test('a non service-Agent /me payload is rejected as AGENT_AUTH_REQUIRED, not treated as an employee', async () => {
  const { adapter } = recordingAdapter({
    handler: () => jsonResponse({
      data: { kind: 'employee', uid: 'u-alice', name: 'Alice', permissions: { catalog: { read: true } } }
    })
  });

  const error = await rejectsWith(adapter.listTools(), 'AGENT_AUTH_REQUIRED', 401);
  assert.equal(error.message, AGENT_AUTH_MESSAGE);
});

test('OA 403 is a generic FORBIDDEN and the raw response details are not disclosed', async () => {
  const secret = 'RAW-FORBIDDEN-DETAILS';
  const { adapter } = recordingAdapter({
    handler: () => jsonResponse({ error: { code: 'FORBIDDEN', message: secret, stack: secret }, detail: secret }, 403)
  });

  const executeError = await rejectsWith(adapter.execute('oa_catalog_create_source', { name: 'X' }), 'FORBIDDEN', 403);
  assert.match(executeError.message, /没有该操作权限/);
  assert.ok(!executeError.message.includes(secret));
  assert.ok(!String(executeError.stack).includes(secret));

  const listError = await rejectsWith(adapter.listTools(), 'FORBIDDEN', 403);
  assert.ok(!listError.message.includes(secret));
});

test('raw fetch failures carrying the Agent key become a generic 503 without leaking key or cause', async () => {
  const { adapter } = recordingAdapter({
    handler: () => {
      throw Object.assign(new Error(`connect failed X-OA-Agent-Key: ${AGENT_KEY}`), {
        cause: new Error(AGENT_KEY),
        code: 'ECONNREFUSED'
      });
    }
  });

  const error = await rejectsWith(adapter.execute('oa_catalog_search_items', { query: 'x' }), 'OA_UNAVAILABLE', 503);

  assert.match(error.message, /无法连接 OA/);
  assert.match(error.message, /勿盲目重复提交/);
  assert.doesNotMatch(error.message, /ECONNREFUSED/);
  const serialized = `${error.message}\n${error.stack ?? ''}\n${JSON.stringify(error)}`;
  assert.ok(!serialized.includes(AGENT_KEY), 'the Agent key must not leak through errors');
  assert.ok(!serialized.includes('svc-agent-key'));
  assert.equal(error.cause, undefined, 'the raw fetch error must not be attached as a cause');
});

test('OA 5xx, invalid JSON and malformed payloads map to generic 503/502 without leaking bodies', async () => {
  {
    const { adapter } = recordingAdapter({ handler: () => new Response(`database exploded X-OA-Agent-Key=${AGENT_KEY}`, { status: 500 }) });
    const error = await rejectsWith(adapter.execute('oa_catalog_upsert_items', { items: [] }), 'OA_UNAVAILABLE', 503);
    assert.ok(!error.message.includes(AGENT_KEY));
  }

  {
    const { adapter } = recordingAdapter({
      handler: () => new Response(`not-json ${AGENT_KEY}`, { status: 200, headers: { 'content-type': 'text/plain' } })
    });
    const error = await rejectsWith(adapter.execute('oa_agent_info', {}), 'INVALID_OA_RESPONSE', 502);
    assert.ok(!error.message.includes(AGENT_KEY));
  }

  {
    const { adapter } = recordingAdapter({ handler: () => jsonResponse({ ok: true }) });
    await rejectsWith(adapter.execute('oa_agent_info', {}), 'INVALID_OA_RESPONSE', 502);
  }

  {
    const { adapter } = recordingAdapter({
      handler: ({ url }) => (pathOf(url).endsWith('/api/ai/me')
        ? jsonResponse({ data: adminIdentity })
        : jsonResponse({ data: { tools: 'not-an-array' } }))
    });
    const error = await rejectsWith(adapter.listTools(), 'INVALID_OA_RESPONSE', 502);
    assert.match(error.message, /工具定义格式不正确/);
  }
});

test('structured business errors keep only code/message/path and drop extra response fields', async () => {
  const secret = 'DO-NOT-LEAK';
  const { adapter } = recordingAdapter({
    handler: () => jsonResponse({
      error: { code: 'VALIDATION_ERROR', message: 'query 不能为空', path: 'arguments.query', stack: secret, cookie: secret },
      data: secret,
      trace: secret
    }, 400)
  });

  const result = await adapter.execute('oa_catalog_search_items', {});
  assert.deepEqual(result, { error: { code: 'VALIDATION_ERROR', message: 'query 不能为空', path: 'arguments.query' } });
  assert.ok(!JSON.stringify(result).includes(secret));
});

test('successful data, including null data, is returned as { data }; non-structured errors fall back safely', async () => {
  {
    const { adapter } = recordingAdapter({ handler: () => jsonResponse({ data: null }) });
    assert.deepEqual(await adapter.execute('oa_agent_info', {}), { data: null });
  }

  {
    const { adapter } = recordingAdapter({ handler: () => jsonResponse({ error: { unexpected: true } }, 400) });
    assert.deepEqual(
      await adapter.execute('oa_catalog_search_items', { query: 'x' }),
      { error: { code: 'OA_REQUEST_FAILED', message: 'OA 请求失败' } }
    );
  }
});
