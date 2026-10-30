/**
 * Host-adapter contract tests for createCatscoOaTools (local entry, no key).
 *
 * Every test uses an in-memory mock fetch; there is no real OA service, no browser
 * session, no cookies, no API key and no network access.
 *
 * Run with: node --test scripts/ai-tool-host-test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { createCatscoOaTools, OaToolHostError } from '../src/lib/server/catsco-oa-tools.js';

const LOCAL_BASE = 'http://127.0.0.1:43107/';
const DEFAULT_BASE = 'http://127.0.0.1:3101/';
const SECRET = 'SUPER-SECRET-DO-NOT-LEAK';

/** /me payload deliberately carries extra identity/config fields that must be dropped. */
const entryIdentity = Object.freeze({
  mode: 'local_entry',
  permissions: {
    catalog: { read: true, manage: true },
    orders: { read: true, create: true }
  },
  agent_id: SECRET,
  kind: 'service_agent',
  display_name: SECRET,
  apiKey: SECRET,
  config: { token: SECRET }
});

const ordersOnlyIdentity = Object.freeze({
  mode: 'local_entry',
  permissions: { orders: { read: true, create: true } }
});

const ordersNoCreateIdentity = Object.freeze({
  mode: 'local_entry',
  permissions: { orders: { read: true, create: false } }
});

const catalogOnlyIdentity = Object.freeze({
  mode: 'local_entry',
  permissions: { catalog: { read: true, manage: true } }
});

const noPermissionIdentity = Object.freeze({
  mode: 'local_entry',
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
    // Must be filtered out: not part of the host allow-list.
    { name: 'delete_everything', description: '危险工具', inputSchema: { type: 'object', properties: { cookie: { type: 'string' } } } },
    { name: '../../api/ai/me', description: '路径注入', inputSchema: { type: 'object', properties: {} } }
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
        // Credential-looking properties and tool-level context must be stripped.
        properties: {
          query: { type: 'string' },
          dry_run: { type: 'boolean' },
          created_by_uid: { type: 'integer' },
          cookie: { type: 'string' },
          authorization: { type: 'string' },
          apiKey: { type: 'string' },
          access_token: { type: 'string' },
          session: { type: 'string' },
          agent_id: { type: 'string' },
          'x-oa-agent-key': { type: 'string' }
        },
        required: ['query', 'cookie', 'apiKey'],
        additionalProperties: false
      },
      context: { cookie: SECRET }
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
          created_by_uid: { type: 'integer' },
          created_by_name: { type: 'string' },
          dry_run: { type: 'boolean' }
        },
        required: ['orders'],
        additionalProperties: false
      }
    },
    // Unknown, path-injection and double-prefixed names must be dropped.
    { name: 'delete_everything', description: '危险订单工具', inputSchema: { type: 'object', properties: {} } },
    { name: '../../api/ai/me', description: '订单路径注入', inputSchema: { type: 'object', properties: {} } },
    { name: 'oa_orders_search_orders', description: '已被前缀命名', inputSchema: { type: 'object', properties: {} } }
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

function defaultHandler({ url, init }) {
  const pathname = pathOf(url);
  if (pathname.endsWith('/api/ai/me')) return jsonResponse({ data: entryIdentity });
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

function ordersHandler({ url, init }) {
  const pathname = pathOf(url);
  if (pathname.endsWith('/api/ai/me')) return jsonResponse({ data: ordersOnlyIdentity });
  if (pathname.endsWith('/api/ai/orders')) {
    if ((init.method ?? 'GET') === 'GET') return jsonResponse({ data: ordersManifest });
    const body = JSON.parse(init.body);
    return jsonResponse({ data: { surface: 'orders', tool: body.tool, arguments: body.arguments } });
  }
  throw new Error(`orders-only mock must not request ${url}`);
}

function catalogHandler({ url, init }) {
  const pathname = pathOf(url);
  if (pathname.endsWith('/api/ai/me')) return jsonResponse({ data: catalogOnlyIdentity });
  if (pathname.endsWith('/api/ai/catalog')) {
    if ((init.method ?? 'GET') === 'GET') return jsonResponse({ data: catalogManifest });
    const body = JSON.parse(init.body);
    return jsonResponse({ data: { surface: 'catalog', tool: body.tool, arguments: body.arguments } });
  }
  throw new Error(`catalog-only mock must not request ${url}`);
}

function recordingAdapter({ handler = defaultHandler, appBaseUrl = LOCAL_BASE, config = {} } = {}) {
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
      credentials: init.credentials,
      signal: init.signal
    };
    calls.push(snapshot);
    return handler(snapshot);
  };
  const adapter = createCatscoOaTools({ appBaseUrl, fetchImpl, ...config });
  return { adapter, calls };
}

function noFetchAdapter(options = {}) {
  let count = 0;
  const adapter = createCatscoOaTools({
    appBaseUrl: LOCAL_BASE,
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

/** No authentication fields in tool schemas; created_by_uid is business attribution. */
function assertNoCredentialSchemaLeak(tools) {
  const serialized = JSON.stringify(tools);
  assert.doesNotMatch(serialized, /cookie|authorization|bearer|api[_-]?key|access[_-]?token|session|x-oa|secret|agent_id/i);
  assert.doesNotMatch(serialized, /currentUserRequest|userContext/i);
  assert.ok(!serialized.includes(SECRET), 'server identity/config extras must never appear in tool definitions');
  for (const tool of tools) {
    assert.equal(typeof tool.name, 'string');
    assert.equal(typeof tool.description, 'string');
    assert.equal(typeof tool.inputSchema, 'object');
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(!('context' in tool), 'host context must never be part of the tool definition');
    assert.ok(!('currentUserRequest' in tool), 'browser request must never be part of the tool definition');
  }
}

/** Only the adapter-set headers may be present: no cookie/auth/key/origin/forwarding headers. */
function assertNoAuthHeaders(call) {
  const names = [...call.headers.keys()].sort();
  const expected = call.method === 'POST' ? ['accept', 'content-type'] : ['accept'];
  assert.deepEqual(names, expected);
  for (const name of [
    'cookie', 'authorization', 'x-oa-agent-key', 'x-api-key',
    'origin', 'referer', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded'
  ]) {
    assert.equal(call.headers.get(name), null, `${name} must never be sent`);
  }
  assert.equal(call.credentials, 'omit');
}

test('config only accepts a loopback root URL on 127.0.0.1 with an explicit port', () => {
  const valid = [
    'http://127.0.0.1:3101/',
    'http://127.0.0.1:3101',
    'http://127.0.0.1:43107/'
  ];
  for (const appBaseUrl of valid) {
    assert.doesNotThrow(
      () => createCatscoOaTools({ appBaseUrl, fetchImpl: async () => { throw new Error('unused'); } }),
      `expected URL to be accepted: ${appBaseUrl}`
    );
  }

  const invalid = [
    // Remote or non-IPv4-loopback hosts.
    'https://127.0.0.1:3101/',
    'http://localhost:3101/',
    'http://[::1]:3101/',
    'http://0.0.0.0:3101/',
    'http://127.0.0.2:3101/',
    'http://192.168.1.5:3101/',
    'http://oa.example.test/',
    // Credentials, query, hash, subpaths and missing/invalid ports.
    'http://user:pass@127.0.0.1:3101/',
    'http://user@127.0.0.1:3101/',
    'http://127.0.0.1:3101/?remote=https://evil.test/',
    'http://127.0.0.1:3101/#fragment',
    'http://127.0.0.1:3101/app42/',
    'http://127.0.0.1:3101/api/ai/me',
    'http://127.0.0.1:3101//',
    'http://127.0.0.1:3101/api/ai/',
    'http://127.0.0.1/',
    'http://127.0.0.1:0/',
    'http://127.0.0.1:70000/',
    // Malformed input.
    '',
    '   ',
    ' http://127.0.0.1:3101/',
    'http://127.0.0.1:3101/ ',
    'not a url',
    null,
    123,
    {}
  ];
  for (const appBaseUrl of invalid) {
    assert.throws(
      () => createCatscoOaTools({ appBaseUrl, fetchImpl: async () => { throw new Error('unused'); } }),
      (error) => error instanceof OaToolHostError
        && error.code === 'INVALID_HOST_CONFIG'
        && error.status === 400
        && !String(error.stack).includes(SECRET),
      `expected URL to be rejected: ${String(appBaseUrl)}`
    );
  }

  // No options at all defaults to the local entry port.
  assert.doesNotThrow(() => createCatscoOaTools());
});

test('explicit apiKey or other unsupported config is rejected without echoing the secret', () => {
  for (const config of [
    { apiKey: SECRET },
    { apiKey: 'k'.repeat(32) },
    { agentKey: SECRET },
    { token: SECRET },
    { headers: { authorization: SECRET } }
  ]) {
    assert.throws(
      () => createCatscoOaTools({ appBaseUrl: LOCAL_BASE, ...config, fetchImpl: async () => { throw new Error('unused'); } }),
      (error) => {
        assert.ok(error instanceof OaToolHostError);
        assert.equal(error.code, 'INVALID_HOST_CONFIG');
        assert.equal(error.status, 400);
        const text = `${error.message}\n${error.stack ?? ''}\n${JSON.stringify(error)}`;
        assert.ok(!text.includes(SECRET), 'the rejected secret must not be echoed');
        assert.doesNotMatch(text, /apiKey|agentKey|token/);
        return true;
      }
    );
  }
  for (const fetchImpl of [null, 'fetch', 1, {}]) {
    assert.throws(
      () => createCatscoOaTools({ appBaseUrl: LOCAL_BASE, fetchImpl }),
      (error) => error instanceof OaToolHostError && error.code === 'INVALID_HOST_CONFIG'
    );
  }
});

test('listTools reads local /me then manifests with fixed URLs and no auth headers', async () => {
  const { adapter, calls } = recordingAdapter();

  assert.equal(adapter.listTools.length, 0, 'listTools must not accept a user/browser context');
  const tools = await adapter.listTools();

  assert.deepEqual(tools.map((tool) => tool.name), [
    'oa_entry_info',
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
  // Agent identity tools must not be exposed at all.
  assert.ok(!tools.some((tool) => tool.name === 'oa_agent_info'));
  assert.ok(!tools.some((tool) => tool.name === 'oa_current_user'));
  assertNoCredentialSchemaLeak(tools);

  // Unprefixed, double-prefixed and path-injection manifest entries are dropped.
  assert.ok(!tools.some((tool) => tool.name === 'delete_everything'));
  assert.ok(!tools.some((tool) => tool.name.includes('/')));
  assert.ok(!tools.some((tool) => tool.name === 'oa_orders_oa_orders_search_orders'));

  const search = tools.find((tool) => tool.name === 'oa_orders_search_orders');
  assert.deepEqual(Object.keys(search.inputSchema.properties).sort(), ['created_by_uid', 'dry_run', 'query']);
  assert.deepEqual(search.inputSchema.required, ['query']);
  assert.equal(search.inputSchema.properties.created_by_uid.type, 'integer');
  const batch = tools.find((tool) => tool.name === 'oa_orders_batch_create_orders');
  assert.ok(batch.inputSchema.properties.created_by_uid);
  assert.ok(batch.inputSchema.properties.created_by_name);

  assert.deepEqual(calls.map((call) => [call.url, call.method]), [
    [`${LOCAL_BASE}api/ai/me`, 'GET'],
    [`${LOCAL_BASE}api/ai/catalog`, 'GET'],
    [`${LOCAL_BASE}api/ai/orders`, 'GET']
  ]);
  for (const call of calls) {
    assert.equal(new URL(call.url).search, '');
    assert.equal(new URL(call.url).hash, '');
    assert.equal(call.body, undefined);
    assert.equal(call.redirect, 'error');
    assert.equal(call.cache, 'no-store');
    assert.ok(call.signal instanceof AbortSignal);
    assertNoAuthHeaders(call);
  }
});

test('oa_entry_info returns only mode and permissions, never agent id, config or employee data', async () => {
  const { adapter, calls } = recordingAdapter();

  const result = await adapter.execute('oa_entry_info', {});
  assert.deepEqual(result, {
    data: {
      mode: 'local_entry',
      permissions: {
        catalog: { read: true, manage: true },
        orders: { read: true, create: true }
      }
    }
  });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(SECRET));
  assert.doesNotMatch(serialized, /agent|service_agent|employee|uid|display_name|kind|apiKey|token/i);

  const tools = await adapter.listTools();
  const info = tools.find((tool) => tool.name === 'oa_entry_info');
  assert.match(info.description, /本机/);
  assert.match(info.description, /不代表任何浏览器登录员工/);
  assert.deepEqual(info.inputSchema, { type: 'object', properties: {}, additionalProperties: false });
  assert.ok(!tools.some((tool) => /agent/i.test(tool.name) || /agent/i.test(tool.description)));

  const before = calls.length;
  for (const args of [
    { uid: 'u-bob' },
    { userId: 'u-bob' },
    { cookie: 'session=bob' },
    { authorization: 'Bearer bob' },
    { token: 'bob-token' },
    { apiKey: SECRET },
    { currentUserRequest: { headers: { cookie: 'session=bob' } } }
  ]) {
    const error = await rejectsWith(adapter.execute('oa_entry_info', args), 'VALIDATION_ERROR', 400);
    assert.match(error.message, /不接受任何参数/);
  }
  assert.equal(calls.length, before, 'rejected arguments must never reach OA');
});

test('an unexpected /me mode is rejected without falling back to a browser session', async () => {
  for (const data of [
    { kind: 'service_agent', agent_id: SECRET, permissions: { orders: { read: true } } },
    { kind: 'employee', uid: 'u-alice', permissions: { catalog: { read: true } } },
    { mode: 'remote', permissions: { catalog: { read: true } } },
    null,
    'local_entry'
  ]) {
    const { adapter, calls } = recordingAdapter({ handler: () => jsonResponse({ data }) });
    const error = await rejectsWith(adapter.listTools(), 'OA_UNAVAILABLE', 503);
    assert.ok(!error.message.includes(SECRET));
    assert.equal(calls.length, 1, 'no retry and no second request');
    assertNoAuthHeaders(calls[0]);
  }
});

test('tool lists follow permissions independently: orders-only, catalog-only and no permissions', async () => {
  {
    const { adapter, calls } = recordingAdapter({ handler: ordersHandler });
    const tools = await adapter.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), [
      'oa_entry_info',
      'oa_orders_search_orders',
      'oa_orders_get_order',
      'oa_orders_list_references',
      'oa_orders_create_order',
      'oa_orders_update_order',
      'oa_orders_batch_create_orders'
    ]);
    assertNoCredentialSchemaLeak(tools);
    assert.deepEqual(calls.map((call) => [pathOf(call.url), call.method]), [
      ['/api/ai/me', 'GET'],
      ['/api/ai/orders', 'GET']
    ]);
  }

  {
    const { adapter, calls } = recordingAdapter({ handler: catalogHandler });
    const tools = await adapter.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), [
      'oa_entry_info',
      'oa_catalog_list_sources',
      'oa_catalog_search_items',
      'oa_catalog_create_source',
      'oa_catalog_upsert_items'
    ]);
    assert.deepEqual(calls.map((call) => [pathOf(call.url), call.method]), [
      ['/api/ai/me', 'GET'],
      ['/api/ai/catalog', 'GET']
    ]);
  }

  {
    const { adapter, calls } = recordingAdapter({
      handler: ({ url }) => (pathOf(url).endsWith('/api/ai/me')
        ? jsonResponse({ data: noPermissionIdentity })
        : jsonResponse({ error: { code: 'FORBIDDEN', message: 'no access' } }, 403))
    });
    const tools = await adapter.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), ['oa_entry_info']);
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
      'oa_entry_info',
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

  assert.deepEqual((await adapter.listTools()).map((tool) => tool.name), ['oa_entry_info']);
  identity = ordersOnlyIdentity;
  const later = await adapter.listTools();
  assert.ok(later.some((tool) => tool.name === 'oa_orders_batch_create_orders'));
  assert.equal(calls.filter((call) => pathOf(call.url).endsWith('/api/ai/me')).length, 2);
});

test('execute rejects unknown tools, agent tools and malformed arguments before any fetch', async () => {
  const { adapter, fetchCount } = noFetchAdapter();

  for (const name of [
    'delete_everything',
    'oa_delete_everything',
    'oa_agent_info',
    'oa_current_user',
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
  await rejectsWith(adapter.execute(undefined, {}), 'UNKNOWN_TOOL', 400);
  await rejectsWith(adapter.execute(123, {}), 'UNKNOWN_TOOL', 400);

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
  const identity = await adapter.execute('oa_entry_info', {}, legacyContext);

  assert.deepEqual(result, { data: { surface: 'catalog', tool: 'search_items', arguments: { query: '阀门' } } });
  assert.equal(identity.data.mode, 'local_entry');
  assert.equal(calls.length, 2);

  const [search, me] = calls;
  assert.equal(search.url, `${LOCAL_BASE}api/ai/catalog`);
  assert.equal(search.method, 'POST');
  assert.equal(me.url, `${LOCAL_BASE}api/ai/me`);
  for (const call of calls) assertNoAuthHeaders(call);
});

test('fixed URL/method/headers cannot be overridden by model arguments', async () => {
  const { adapter, calls } = recordingAdapter();
  const modelArguments = {
    query: '阀门',
    tool: 'create_source',
    path: '/api/ai/me',
    url: 'http://127.0.0.1:43107/api/ai/me',
    appBaseUrl: 'http://127.0.0.1:9999/',
    endpoint: '../../api/ai/me',
    method: 'DELETE',
    redirect: 'follow',
    headers: { cookie: 'session=attacker', authorization: 'Bearer x' },
    apiKey: SECRET,
    token: 'attacker-token'
  };

  const result = await adapter.execute('oa_catalog_search_items', modelArguments);

  assert.deepEqual(result, { data: { surface: 'catalog', tool: 'search_items', arguments: modelArguments } });
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.url, `${LOCAL_BASE}api/ai/catalog`);
  assert.equal(new URL(call.url).origin, 'http://127.0.0.1:43107');
  assert.equal(new URL(call.url).search, '');
  assert.equal(new URL(call.url).pathname, '/api/ai/catalog');
  assert.equal(call.method, 'POST');
  assert.equal(call.redirect, 'error');
  assert.equal(call.cache, 'no-store');
  assertNoAuthHeaders(call);
  const body = JSON.parse(call.body);
  assert.equal(body.tool, 'search_items', 'arguments cannot replace the selected tool');
  assert.deepEqual(body.arguments, modelArguments);
});

test('oa_orders_batch_create_orders maps to the fixed orders path without auth', async () => {
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
  assert.equal(call.url, `${LOCAL_BASE}api/ai/orders`);
  assert.equal(call.method, 'POST');
  assert.equal(call.redirect, 'error');
  assert.equal(call.cache, 'no-store');
  assertNoAuthHeaders(call);
  assert.equal(call.headers.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(call.body), { tool: 'batch_create_orders', arguments: batchArguments });
});

test('default configuration targets http://127.0.0.1:3101/ and sends no auth', async () => {
  const calls = [];
  const adapter = createCatscoOaTools({
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init, headers: new Headers(init.headers), method: init.method, credentials: init.credentials });
      return jsonResponse({ data: entryIdentity });
    }
  });
  const result = await adapter.execute('oa_entry_info', {});
  assert.equal(result.data.mode, 'local_entry');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${DEFAULT_BASE}api/ai/me`);
  assert.equal(calls[0].method, 'GET');
  assertNoAuthHeaders({ ...calls[0], headers: calls[0].headers });
});

test('401/403 become a generic 503 with no login prompt, secret or cookie fallback, and no retry', async () => {
  for (const status of [401, 403]) {
    const { adapter, calls } = recordingAdapter({
      handler: () => jsonResponse({ error: { code: 'FORBIDDEN', message: SECRET }, detail: SECRET }, status)
    });

    const listError = await rejectsWith(adapter.listTools(), 'OA_UNAVAILABLE', 503);
    const executeError = await rejectsWith(adapter.execute('oa_catalog_search_items', { query: 'x' }), 'OA_UNAVAILABLE', 503);

    for (const error of [listError, executeError]) {
      assert.equal(error.message, '本机 OA 入口未就绪或拒绝了请求，请确认本机代录服务已启动。');
      assert.doesNotMatch(error.message, /请登录|请提供|Cookie|Token|Key|Agent|UID/i);
      assert.ok(!error.message.includes(SECRET));
      assert.ok(!String(error.stack).includes(SECRET));
    }
    // No retry and no fallback to any browser session: exactly one request per call.
    assert.equal(calls.length, 2);
    for (const call of calls) assertNoAuthHeaders(call);
  }
});

test('raw fetch failures become a generic 503 without leaking URL, key or cause', async () => {
  const { adapter, calls } = recordingAdapter({
    handler: () => {
      throw Object.assign(new Error(`connect failed at ${LOCAL_BASE} token=${SECRET}`), {
        cause: new Error(SECRET),
        code: 'ECONNREFUSED'
      });
    }
  });

  const error = await rejectsWith(adapter.execute('oa_catalog_search_items', { query: 'x' }), 'OA_UNAVAILABLE', 503);

  assert.match(error.message, /无法连接本机 OA 入口/);
  assert.match(error.message, /勿盲目重复提交/);
  assert.doesNotMatch(error.message, /ECONNREFUSED|127\.0\.0\.1|43107/);
  const serialized = `${error.message}\n${error.stack ?? ''}\n${JSON.stringify(error)}`;
  assert.ok(!serialized.includes(SECRET), 'the raw failure must not leak through errors');
  assert.equal(error.cause, undefined, 'the raw fetch error must not be attached as a cause');
  assert.equal(calls.length, 1, 'fetch failures are never retried');
});

test('OA 5xx, invalid JSON and malformed payloads map to generic 503/502 without leaking bodies', async () => {
  {
    const { adapter, calls } = recordingAdapter({
      handler: () => new Response(`database exploded ${SECRET}`, { status: 500 })
    });
    const error = await rejectsWith(adapter.execute('oa_catalog_upsert_items', { items: [] }), 'OA_UNAVAILABLE', 503);
    assert.ok(!error.message.includes(SECRET));
    assert.equal(calls.length, 1);
  }

  {
    const { adapter } = recordingAdapter({
      handler: () => new Response(`not-json ${SECRET}`, { status: 200, headers: { 'content-type': 'text/plain' } })
    });
    const error = await rejectsWith(adapter.execute('oa_entry_info', {}), 'INVALID_OA_RESPONSE', 502);
    assert.ok(!error.message.includes(SECRET));
  }

  {
    const { adapter } = recordingAdapter({ handler: () => jsonResponse({ ok: true }) });
    await rejectsWith(adapter.execute('oa_entry_info', {}), 'INVALID_OA_RESPONSE', 502);
  }

  {
    const { adapter } = recordingAdapter({
      handler: ({ url }) => (pathOf(url).endsWith('/api/ai/me')
        ? jsonResponse({ data: entryIdentity })
        : jsonResponse({ data: { tools: 'not-an-array' } }))
    });
    const error = await rejectsWith(adapter.listTools(), 'INVALID_OA_RESPONSE', 502);
    assert.match(error.message, /工具定义格式不正确/);
  }
});

test('structured business errors keep only code/message/path and drop extra response fields', async () => {
  const { adapter } = recordingAdapter({
    handler: () => jsonResponse({
      error: { code: 'VALIDATION_ERROR', message: 'query 不能为空', path: 'arguments.query', stack: SECRET, cookie: SECRET },
      data: SECRET,
      trace: SECRET
    }, 400)
  });

  const result = await adapter.execute('oa_catalog_search_items', {});
  assert.deepEqual(result, { error: { code: 'VALIDATION_ERROR', message: 'query 不能为空', path: 'arguments.query' } });
  assert.ok(!JSON.stringify(result).includes(SECRET));
});

test('default transport uses plain loopback HTTP without browser or auth headers', async () => {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, method: req.method, headers: req.headers });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      data: { mode: 'local_entry', permissions: { catalog: { read: true }, orders: { read: true, create: false } } }
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const adapter = createCatscoOaTools({ appBaseUrl: `http://127.0.0.1:${address.port}/` });
    const result = await adapter.execute('oa_entry_info', {});
    assert.equal(result.data.mode, 'local_entry');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, '/api/ai/me');
    assert.equal(seen[0].method, 'GET');

    const names = Object.keys(seen[0].headers).map((name) => name.toLowerCase());
    for (const forbidden of [
      'cookie', 'authorization', 'x-oa-agent-key', 'x-api-key', 'origin',
      'referer', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded',
      'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest', 'sec-purpose', 'purpose'
    ]) {
      assert.ok(!names.includes(forbidden), `${forbidden} must never be sent`);
    }
    assert.equal(seen[0].headers.accept, 'application/json');
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('successful data, including null data, is returned as { data }; non-structured errors fall back safely', async () => {
  {
    const { adapter } = recordingAdapter({ handler: () => jsonResponse({ data: null }) });
    assert.deepEqual(await adapter.execute('oa_catalog_search_items', { query: 'x' }), { data: null });
  }

  {
    const { adapter } = recordingAdapter({ handler: () => jsonResponse({ error: { unexpected: true } }, 400) });
    assert.deepEqual(
      await adapter.execute('oa_catalog_search_items', { query: 'x' }),
      { error: { code: 'OA_REQUEST_FAILED', message: 'OA 请求失败' } }
    );
  }
});
