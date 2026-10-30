/**
 * Host-adapter contract tests for createCatscoOaTools.
 * These tests use only in-memory Request objects and mock fetch implementations;
 * no real OA service, cookies, credentials or network calls are involved.
 *
 * Run with: node --test scripts/ai-tool-host-test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createCatscoOaTools, OaToolHostError } from '../src/lib/server/catsco-oa-tools.js';

const APP_BASE = 'https://oa.example.test/app42/';
const CHAT_ORIGIN = 'https://catsco.example.test/chat';
const LOGIN_MESSAGE = '未取得当前 Catsco 用户的有效登录上下文，请登录并重新发起操作；不要向 AI 提供 Cookie、Token 或 UID 作为认证。';

const adminIdentity = Object.freeze({
  uid: 'u-alice',
  name: 'Alice',
  roles: ['catalog_admin'],
  permissions: { catalog: { read: true, manage: true } }
});

const catalogManifest = Object.freeze({
  version: 1,
  tools: [
    {
      name: 'list_sources',
      description: '列出资料库来源',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        additionalProperties: false
      }
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
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        additionalProperties: false
      }
    },
    {
      name: 'upsert_items',
      description: '写入资料库条目',
      inputSchema: {
        type: 'object',
        properties: { source_id: { type: 'string' }, items: { type: 'array' } },
        additionalProperties: false
      }
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

// /api/ai/me 即将返回的订单权限形状：{read, create, manage_all, view_all, edit_scope}。
// 财务可读订单但没有资料库权限。
const financeOrdersIdentity = Object.freeze({
  uid: 'u-finance',
  name: 'Finance',
  roles: ['finance'],
  permissions: {
    catalog: { read: false, manage: false },
    orders: { read: true, create: false, manage_all: false, view_all: true, edit_scope: 'participating' }
  }
});

// 只有订单权限、连 catalog 键都没有的身份，用于验证缺少 catalog 时仍可读订单。
const ordersOnlyIdentity = Object.freeze({
  uid: 'u-bob',
  name: 'Bob',
  roles: ['finance'],
  permissions: {
    orders: { read: true, create: true, manage_all: false, view_all: false, edit_scope: 'participating' }
  }
});

const bothRolesIdentity = Object.freeze({
  uid: 'u-alice',
  name: 'Alice',
  roles: ['catalog_admin', 'order_admin'],
  permissions: {
    catalog: { read: true, manage: true },
    orders: { read: true, create: true, manage_all: true, view_all: true, edit_scope: 'all' }
  }
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
      inputSchema: {
        type: 'object',
        properties: { order_id: { type: 'string' } },
        required: ['order_id'],
        additionalProperties: false
      }
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
    // Must be filtered out: not part of the host's order allow-list.
    {
      name: 'delete_everything',
      description: '危险且未授权的订单工具',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: '../../api/ai/me',
      description: '订单路径注入工具',
      inputSchema: { type: 'object', properties: {} }
    },
    // Already namespaced names must not be double-prefixed.
    {
      name: 'oa_orders_search_orders',
      description: '已被前缀命名的工具',
      inputSchema: { type: 'object', properties: {} }
    }
  ]
});

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

function makeRequest(headers = {}) {
  return new Request(CHAT_ORIGIN, { headers });
}

function sessionRequest(name = 'alice') {
  return makeRequest({ cookie: `session=${name}` });
}

function pathOf(url) {
  return new URL(String(url)).pathname;
}

function defaultAdminHandler(snapshot) {
  const { url, init } = snapshot;
  const pathname = pathOf(url);
  if (pathname.endsWith('/api/ai/me')) {
    return jsonResponse({ data: adminIdentity });
  }
  if (pathname.endsWith('/api/ai/catalog')) {
    if ((init.method ?? 'GET') === 'GET') {
      return jsonResponse({ data: catalogManifest });
    }
    const body = JSON.parse(init.body);
    return jsonResponse({ data: { ok: true, tool: body.tool, arguments: body.arguments } });
  }
  throw new Error(`unexpected mock URL: ${url}`);
}

/** Orders-only OA surface: catalog must never be requested for this identity. */
function ordersOnlyHandler(snapshot) {
  const { url, init } = snapshot;
  const pathname = pathOf(url);
  if (pathname.endsWith('/api/ai/me')) return jsonResponse({ data: financeOrdersIdentity });
  if (pathname.endsWith('/api/ai/orders')) {
    if ((init.method ?? 'GET') === 'GET') return jsonResponse({ data: ordersManifest });
    const body = JSON.parse(init.body);
    return jsonResponse({ data: { surface: 'orders', tool: body.tool, arguments: body.arguments } });
  }
  throw new Error(`orders-only mock must not request ${url}`);
}

/** Both catalog and orders surfaces for the same identity. */
function combinedHandler(snapshot) {
  const { url, init } = snapshot;
  const pathname = pathOf(url);
  if (pathname.endsWith('/api/ai/me')) return jsonResponse({ data: bothRolesIdentity });
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

function recordingAdapter({ handler = defaultAdminHandler, appBaseUrl = APP_BASE } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const snapshot = {
      url: url instanceof URL ? url.href : String(url),
      init: { ...init },
      headers: new Headers(init.headers),
      method: init.method,
      body: init.body,
      redirect: init.redirect,
      cache: init.cache,
      signal: init.signal
    };
    calls.push(snapshot);
    return handler(snapshot);
  };
  return { adapter: createCatscoOaTools({ appBaseUrl, fetchImpl }), calls };
}

function noFetchAdapter() {
  let count = 0;
  const adapter = createCatscoOaTools({
    appBaseUrl: APP_BASE,
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

function assertNoCredentialSchemaLeak(tools) {
  const schemas = JSON.stringify(tools.map((tool) => tool.inputSchema));
  assert.doesNotMatch(schemas, /cookie|authorization|token|x-user-uid|currentUserRequest/i);
  assert.doesNotMatch(schemas, /(^|[^a-z])uid([^a-z]|$)/i);
  for (const tool of tools) {
    assert.equal(typeof tool.name, 'string');
    assert.equal(typeof tool.description, 'string');
    assert.equal(typeof tool.inputSchema, 'object');
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(!('currentUserRequest' in tool), 'host context must never be part of the tool definition');
    assert.ok(!('context' in tool), 'host context must never be part of the tool definition');
  }
}

test('rejects unsafe or ambiguous host base configuration', () => {
  const invalid = [
    'http://oa.example.test/app42/',
    'ftp://oa.example.test/app42/',
    'https://user:password@oa.example.test/app42/',
    'https://oa.example.test/app42/?redirect=https://evil.test/',
    'https://oa.example.test/app42/#fragment'
  ];
  for (const appBaseUrl of invalid) {
    assert.throws(
      () => createCatscoOaTools({ appBaseUrl, fetchImpl: async () => { throw new Error('unused'); } }),
      (error) => error instanceof OaToolHostError
        && error.code === 'INVALID_HOST_CONFIG'
        && error.status === 400,
      `expected configuration to be rejected: ${appBaseUrl}`
    );
  }

  // Plain HTTP is tolerated only for local development hosts.
  for (const appBaseUrl of [
    'http://localhost:5173/app42/',
    'http://127.0.0.1:5173/app42/',
    'http://[::1]:5173/app42/'
  ]) {
    assert.doesNotThrow(() => createCatscoOaTools({ appBaseUrl, fetchImpl: async () => { throw new Error('unused'); } }));
  }
});

test('listTools exposes only identity plus allow-listed, namespaced tools without credentials or UID in schemas', async () => {
  const { adapter, calls } = recordingAdapter();
  const context = { currentUserRequest: makeRequest({ cookie: 'session=alice', authorization: 'Bearer alice-token' }) };

  const tools = await adapter.listTools(context);

  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      'oa_current_user',
      'oa_catalog_list_sources',
      'oa_catalog_search_items',
      'oa_catalog_create_source',
      'oa_catalog_upsert_items'
    ]
  );
  assert.deepEqual(tools[0].inputSchema, {
    type: 'object',
    properties: {},
    additionalProperties: false
  });
  assert.deepEqual(
    Object.keys(tools[0].inputSchema.properties),
    [],
    'oa_current_user must accept no identity fields'
  );
  assert.equal(tools[0].inputSchema.additionalProperties, false);
  assertNoCredentialSchemaLeak(tools);

  // Manifest tools cannot smuggle an unprefixed name or an unknown host tool.
  assert.ok(!tools.some((tool) => tool.name === 'delete_everything'));
  assert.ok(!tools.some((tool) => tool.name === '../../api/ai/me'));
  assert.ok(tools.every((tool) => tool.name === 'oa_current_user' || tool.name.startsWith('oa_catalog_')));

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://oa.example.test/app42/api/ai/me');
  assert.equal(calls[1].url, 'https://oa.example.test/app42/api/ai/catalog');
  for (const call of calls) {
    assert.equal(call.method, 'GET');
    assert.equal(call.body, undefined);
    assert.equal(call.redirect, 'error');
    assert.equal(call.cache, 'no-store');
    assert.ok(call.signal instanceof AbortSignal);
    assert.equal(call.headers.get('cookie'), 'session=alice');
    assert.equal(call.headers.get('authorization'), 'Bearer alice-token');
    assert.equal(call.headers.get('x-user-uid'), null);
    assert.equal(call.headers.get('content-type'), null);
  }
});

test('oa_current_user takes an empty object, returns /me data, and rejects every identity argument', async () => {
  const { adapter, calls } = recordingAdapter();
  const context = { currentUserRequest: sessionRequest('alice') };

  const result = await adapter.execute('oa_current_user', {}, context);

  assert.deepEqual(result, { data: adminIdentity });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://oa.example.test/app42/api/ai/me');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].body, undefined);

  const rejectedArguments = [
    { uid: 'u-bob' },
    { userId: 'u-bob' },
    { cookie: 'session=bob' },
    { authorization: 'Bearer bob' },
    { token: 'bob-token' },
    { currentUserRequest: makeRequest({ cookie: 'session=bob' }) },
    { context: { currentUserRequest: makeRequest({ cookie: 'session=bob' }) } }
  ];
  for (const args of rejectedArguments) {
    const error = await rejectsWith(adapter.execute('oa_current_user', args, context), 'VALIDATION_ERROR', 400);
    assert.match(error.message, /不接受任何身份参数/);
  }
  assert.equal(calls.length, 1, 'rejected identity arguments must never reach OA');
});

test('execute rejects unknown tools and malformed argument payloads before any fetch', async () => {
  const { adapter, fetchCount } = noFetchAdapter();
  const context = { currentUserRequest: sessionRequest('alice') };

  for (const name of [
    'delete_everything',
    'oa_delete_everything',
    'oa_catalog_delete_everything',
    'oa_catalog_',
    'oa_catalog_../../api/ai/me',
    'api/ai/me',
    'oa_catalog_list_sources/../../me',
    'list_sources',
    // Orders surface: wrong prefix (singular) and non-allow-listed names must not map anywhere.
    'oa_order_search_orders',
    'oa_orders_delete_everything',
    'oa_orders_',
    'oa_orders_../../api/ai/me',
    'oa_orders_search_orders/../../me',
    'oa_orders_oa_orders_search_orders',
    'search_orders',
    'create_order',
    ''
  ]) {
    await rejectsWith(adapter.execute(name, {}, context), 'UNKNOWN_TOOL', 400);
  }

  for (const args of [undefined, null, [], 'query', 1, true]) {
    await rejectsWith(adapter.execute('oa_catalog_search_items', args, context), 'VALIDATION_ERROR', 400);
  }

  assert.equal(fetchCount(), 0);
});

test('missing session or self-reported x-user-uid is rejected without fetch and without asking for credentials', async () => {
  const { adapter, fetchCount } = noFetchAdapter();
  const noAuthRequest = makeRequest();
  const uidOnlyRequest = makeRequest({ 'x-user-uid': 'u-alice' });
  const trustedLookingRequest = makeRequest({
    'x-user-uid': 'u-alice',
    'x-user-role': 'catalog_admin',
    'x-forwarded-user': 'alice'
  });

  const contexts = [
    undefined,
    null,
    {},
    { currentUserRequest: null },
    { currentUserRequest: {} },
    { currentUserRequest: CHAT_ORIGIN },
    { currentUserRequest: noAuthRequest },
    { currentUserRequest: uidOnlyRequest },
    { currentUserRequest: trustedLookingRequest }
  ];

  for (const context of contexts) {
    const listError = await rejectsWith(adapter.listTools(context), 'LOGIN_REQUIRED', 401);
    const executeError = await rejectsWith(adapter.execute('oa_current_user', {}, context), 'LOGIN_REQUIRED', 401);
    for (const error of [listError, executeError]) {
      assert.equal(error.message, LOGIN_MESSAGE);
      assert.match(error.message, /登录/);
      assert.match(error.message, /不要向 AI 提供 Cookie、Token 或 UID/);
      assert.doesNotMatch(error.message, /(请|需要|必须|应当)(你|用户)?(提供|输入|发送|告知)/);
      assert.doesNotMatch(error.message, /x-user-uid/i);
    }
  }

  assert.equal(fetchCount(), 0, 'unauthenticated calls must not touch the network');
});

test('OA 401 becomes a clear login instruction, never a credential request and never a body leak', async () => {
  const secret = 'SUPER-SECRET-cookie-value';
  const { adapter, calls } = recordingAdapter({
    handler: () => new Response(JSON.stringify({ error: { message: `please send Cookie=${secret}` } }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    })
  });

  const error = await rejectsWith(
    adapter.execute('oa_current_user', {}, { currentUserRequest: makeRequest({ authorization: 'Bearer expired' }) }),
    'LOGIN_REQUIRED',
    401
  );

  assert.equal(error.message, LOGIN_MESSAGE);
  assert.match(error.message, /请登录并重新发起操作/);
  assert.doesNotMatch(error.message, /请提供|请输入|请发送|需要提供|需要你/);
  assert.ok(!error.message.includes(secret));
  assert.ok(!String(error.stack).includes(secret));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.get('authorization'), 'Bearer expired');
});

test('OA 403 is rejected and the raw forbidden response is not disclosed', async () => {
  const secret = 'RAW-FORBIDDEN-DETAILS';
  const { adapter, calls } = recordingAdapter({
    handler: () => jsonResponse({
      error: { code: 'FORBIDDEN', message: secret, stack: secret },
      detail: secret
    }, 403)
  });
  const context = { currentUserRequest: sessionRequest('alice') };

  const executeError = await rejectsWith(
    adapter.execute('oa_catalog_create_source', { name: 'X' }, context),
    'FORBIDDEN',
    403
  );
  assert.match(executeError.message, /没有该操作权限/);
  assert.ok(!executeError.message.includes(secret));
  assert.ok(!String(executeError.stack).includes(secret));

  const listError = await rejectsWith(adapter.listTools(context), 'FORBIDDEN', 403);
  assert.ok(!listError.message.includes(secret));
  assert.equal(calls.length, 2);
});

test('fetch is called with redirect:error and cache:no-store for reads and writes', async () => {
  const { adapter, calls } = recordingAdapter();
  const context = { currentUserRequest: sessionRequest('alice') };

  await adapter.listTools(context);
  await adapter.execute('oa_catalog_search_items', { query: '阀门', dry_run: true }, context);

  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.redirect, 'error', 'redirects must never be followed');
    assert.equal(call.cache, 'no-store', 'responses must never be cached');
  }
  const writeCall = calls[2];
  assert.equal(writeCall.method, 'POST');
  assert.equal(writeCall.headers.get('content-type'), 'application/json');
  assert.equal(writeCall.headers.get('cookie'), 'session=alice');
  assert.equal(writeCall.redirect, 'error');
  assert.equal(writeCall.cache, 'no-store');
});

test('fixed subpath URL and tool selection cannot be overridden by model arguments', async () => {
  const { adapter, calls } = recordingAdapter({ appBaseUrl: 'https://oa.example.test/app42' });
  const context = { currentUserRequest: sessionRequest('alice') };
  const modelArguments = {
    query: '阀门',
    tool: 'create_source',
    path: '/api/ai/me',
    url: 'https://attacker.example/steal',
    appBaseUrl: 'https://attacker.example/',
    base: 'https://attacker.example/',
    endpoint: '../../api/ai/me',
    method: 'DELETE',
    redirect: 'follow',
    headers: { cookie: 'session=attacker' }
  };

  const result = await adapter.execute('oa_catalog_search_items', modelArguments, context);

  assert.deepEqual(result, {
    data: { ok: true, tool: 'search_items', arguments: modelArguments }
  });
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.url, 'https://oa.example.test/app42/api/ai/catalog');
  assert.equal(new URL(call.url).origin, 'https://oa.example.test');
  assert.equal(new URL(call.url).search, '');
  assert.equal(new URL(call.url).pathname, '/app42/api/ai/catalog');
  assert.equal(call.method, 'POST');
  assert.equal(call.redirect, 'error');
  assert.equal(call.cache, 'no-store');
  const body = JSON.parse(call.body);
  assert.equal(body.tool, 'search_items', 'arguments cannot replace the selected tool');
  assert.deepEqual(body.arguments, modelArguments);
  assert.equal(call.headers.get('cookie'), 'session=alice');
  assert.equal(call.headers.get('x-user-uid'), null);

  await adapter.listTools(context);
  assert.equal(calls[1].url, 'https://oa.example.test/app42/api/ai/me');
  assert.equal(calls[2].url, 'https://oa.example.test/app42/api/ai/catalog');
});

test('one adapter keeps concurrent users isolated and never reuses credentials between calls', async () => {
  const calls = [];
  const seenUsers = [];
  const fetchImpl = async (url, init) => {
    const headers = new Headers(init.headers);
    const cookie = headers.get('cookie');
    const authorization = headers.get('authorization');
    const user = cookie?.includes('alice') ? 'alice' : authorization?.includes('bob') ? 'bob' : cookie?.includes('carol') ? 'carol' : 'anonymous';
    calls.push({ url: url instanceof URL ? url.href : String(url), headers, method: init.method });
    seenUsers.push(user);
    // Alice is slow, Bob is fast: any shared mutable context would mix them up.
    await new Promise((resolve) => setTimeout(resolve, user === 'alice' ? 30 : 3));
    const pathname = pathOf(url);
    if (pathname.endsWith('/api/ai/me')) {
      return jsonResponse({ data: { uid: `u-${user}`, name: user, permissions: { catalog: { read: true } } } });
    }
    if (pathname.endsWith('/api/ai/catalog')) {
      if ((init.method ?? 'GET') === 'GET') return jsonResponse({ data: catalogManifest });
      const body = JSON.parse(init.body);
      return jsonResponse({ data: { seenUser: user, tool: body.tool, arguments: body.arguments } });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const adapter = createCatscoOaTools({ appBaseUrl: APP_BASE, fetchImpl });
  const alice = { currentUserRequest: makeRequest({ cookie: 'session=alice' }) };
  const bob = { currentUserRequest: makeRequest({ authorization: 'Bearer bob-token' }) };

  const [aliceMe, bobMe, aliceTools, bobTools, aliceSearch, bobSearch] = await Promise.all([
    adapter.execute('oa_current_user', {}, alice),
    adapter.execute('oa_current_user', {}, bob),
    adapter.listTools(alice),
    adapter.listTools(bob),
    adapter.execute('oa_catalog_search_items', { query: 'alice-only' }, alice),
    adapter.execute('oa_catalog_search_items', { query: 'bob-only' }, bob)
  ]);

  assert.equal(aliceMe.data.uid, 'u-alice');
  assert.equal(bobMe.data.uid, 'u-bob');
  assert.equal(aliceTools.length, 5);
  assert.equal(bobTools.length, 5);
  assert.deepEqual(aliceSearch.data, { seenUser: 'alice', tool: 'search_items', arguments: { query: 'alice-only' } });
  assert.deepEqual(bobSearch.data, { seenUser: 'bob', tool: 'search_items', arguments: { query: 'bob-only' } });

  assert.equal(calls.length, 8);
  for (const call of calls) {
    const cookie = call.headers.get('cookie');
    const authorization = call.headers.get('authorization');
    assert.ok(cookie || authorization);
    assert.ok(!(cookie && authorization), 'credentials from different users must not be merged');
    assert.equal(call.headers.get('x-user-uid'), null);
  }
  assert.equal(calls.filter((call) => call.headers.get('cookie') === 'session=alice').length, 4);
  assert.equal(calls.filter((call) => call.headers.get('authorization') === 'Bearer bob-token').length, 4);
  assert.ok(seenUsers.includes('alice'));
  assert.ok(seenUsers.includes('bob'));

  // A later user on the same adapter must not inherit Alice's or Bob's context.
  const carol = { currentUserRequest: makeRequest({ cookie: 'session=carol' }) };
  const carolMe = await adapter.execute('oa_current_user', {}, carol);
  assert.equal(carolMe.data.uid, 'u-carol');
  assert.equal(calls.at(-1).headers.get('cookie'), 'session=carol');
  assert.equal(calls.at(-1).headers.get('authorization'), null);
});

test('listTools for a finance user with no catalog permission exposes only oa_current_user', async () => {
  const calls = [];
  const adapter = createCatscoOaTools({
    appBaseUrl: APP_BASE,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method });
      if (pathOf(url).endsWith('/api/ai/me')) {
        return jsonResponse({ data: { uid: 'u-finance', roles: ['finance'], permissions: { catalog: { read: false, manage: false } } } });
      }
      if (pathOf(url).endsWith('/api/ai/catalog') && init.method === 'POST') {
        return jsonResponse({ error: { code: 'FORBIDDEN', message: 'no access' } }, 403);
      }
      throw new Error(`finance list must not request ${url}`);
    }
  });
  const finance = { currentUserRequest: sessionRequest('finance') };

  const tools = await adapter.listTools(finance);

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'oa_current_user');
  assert.deepEqual(tools[0].inputSchema.properties, {});
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/ai\/me$/);
  assert.equal(calls[0].method, 'GET');

  // An earlier/other tool list is not authorization: OA still re-validates the write.
  await rejectsWith(adapter.execute('oa_catalog_create_source', { name: 'X' }, finance), 'FORBIDDEN', 403);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, 'POST');
});

test('orders and catalog manifests are registered together with distinct oa_orders_/oa_catalog_ prefixes', async () => {
  const { adapter, calls } = recordingAdapter({ handler: combinedHandler });
  const context = { currentUserRequest: makeRequest({ cookie: 'session=alice', authorization: 'Bearer alice-token' }) };

  const tools = await adapter.listTools(context);

  assert.deepEqual(tools.map((tool) => tool.name), [
    'oa_current_user',
    'oa_catalog_list_sources',
    'oa_catalog_search_items',
    'oa_catalog_create_source',
    'oa_catalog_upsert_items',
    'oa_orders_search_orders',
    'oa_orders_get_order',
    'oa_orders_list_references',
    'oa_orders_create_order',
    'oa_orders_update_order'
  ]);
  assertNoCredentialSchemaLeak(tools);
  // Unprefixed, double-prefixed and path-injection manifest entries must be dropped.
  assert.ok(!tools.some((tool) => tool.name === 'delete_everything'));
  assert.ok(!tools.some((tool) => tool.name === 'oa_orders_delete_everything'));
  assert.ok(!tools.some((tool) => tool.name === 'oa_orders_oa_orders_search_orders'));
  assert.ok(!tools.some((tool) => tool.name.includes('/')));
  // The orders surface must never use the singular oa_order_ prefix.
  assert.ok(!tools.some((tool) => tool.name.startsWith('oa_order_')));

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
    assert.equal(call.body, undefined);
    assert.equal(call.redirect, 'error');
    assert.equal(call.cache, 'no-store');
    assert.ok(call.signal instanceof AbortSignal);
    assert.equal(call.headers.get('cookie'), 'session=alice');
    assert.equal(call.headers.get('authorization'), 'Bearer alice-token');
    assert.equal(call.headers.get('x-user-uid'), null);
    assert.equal(call.headers.get('content-type'), null);
  }
});

test('a finance user who can read orders but not catalog still gets only the permitted order tools', async () => {
  const { adapter, calls } = recordingAdapter({ handler: ordersOnlyHandler });
  const finance = { currentUserRequest: sessionRequest('finance') };

  const tools = await adapter.listTools(finance);

  // create:false filters create_order; update_order stays because the orders manifest decides by identity.
  assert.deepEqual(tools.map((tool) => tool.name), [
    'oa_current_user',
    'oa_orders_search_orders',
    'oa_orders_get_order',
    'oa_orders_list_references',
    'oa_orders_update_order'
  ]);
  assert.ok(!tools.some((tool) => tool.name === 'oa_orders_create_order'));
  assert.ok(!tools.some((tool) => tool.name.startsWith('oa_catalog_')));
  assertNoCredentialSchemaLeak(tools);

  // Catalog must not be requested at all when the user has no catalog read permission.
  assert.deepEqual(calls.map((call) => [pathOf(call.url), call.method]), [
    ['/app42/api/ai/me', 'GET'],
    ['/app42/api/ai/orders', 'GET']
  ]);

  const read = await adapter.execute('oa_orders_get_order', { order_id: 'PO-1001' }, finance);
  assert.deepEqual(read, { data: { surface: 'orders', tool: 'get_order', arguments: { order_id: 'PO-1001' } } });
  assert.equal(calls[2].url, 'https://oa.example.test/app42/api/ai/orders');
  assert.equal(calls[2].method, 'POST');
  assert.equal(calls[2].headers.get('cookie'), 'session=finance');
  assert.equal(calls[2].headers.get('x-user-uid'), null);

  // The filtered create tool is not silently re-routed; OA re-validates the write anyway.
  const { adapter: forbidding } = recordingAdapter({
    handler: ({ url, init }) => {
      if (pathOf(url).endsWith('/api/ai/me')) return jsonResponse({ data: financeOrdersIdentity });
      if (pathOf(url).endsWith('/api/ai/orders') && init.method === 'POST') {
        return jsonResponse({ error: { code: 'FORBIDDEN', message: 'no create permission' } }, 403);
      }
      throw new Error(`unexpected URL ${url}`);
    }
  });
  await rejectsWith(forbidding.execute('oa_orders_create_order', { customer_name: 'X' }, finance), 'FORBIDDEN', 403);
});

test('oa_orders_* execute maps to the fixed /api/ai/orders path while catalog keeps /api/ai/catalog', async () => {
  const { adapter, calls } = recordingAdapter({ handler: combinedHandler, appBaseUrl: 'https://oa.example.test/app42' });
  const context = { currentUserRequest: makeRequest({ cookie: 'session=alice' }) };
  const modelArguments = {
    query: 'PO-1001',
    tool: 'create_order',
    path: '/api/ai/me',
    url: 'https://attacker.example/steal',
    appBaseUrl: 'https://attacker.example/',
    endpoint: '../../api/ai/catalog',
    method: 'DELETE',
    headers: { cookie: 'session=attacker' }
  };

  const searched = await adapter.execute('oa_orders_search_orders', modelArguments, context);
  const updated = await adapter.execute('oa_orders_update_order', { order_id: 'PO-1001', patch: { remark: 'ok' } }, context);
  const cataloged = await adapter.execute('oa_catalog_search_items', { query: '阀门' }, context);

  assert.deepEqual(searched, { data: { surface: 'orders', tool: 'search_orders', arguments: modelArguments } });
  assert.deepEqual(updated, { data: { surface: 'orders', tool: 'update_order', arguments: { order_id: 'PO-1001', patch: { remark: 'ok' } } } });
  assert.deepEqual(cataloged, { data: { surface: 'catalog', tool: 'search_items', arguments: { query: '阀门' } } });

  assert.deepEqual(calls.map((call) => [pathOf(call.url), call.method]), [
    ['/app42/api/ai/orders', 'POST'],
    ['/app42/api/ai/orders', 'POST'],
    ['/app42/api/ai/catalog', 'POST']
  ]);
  for (const call of calls) {
    assert.equal(new URL(call.url).origin, 'https://oa.example.test');
    assert.equal(new URL(call.url).search, '');
    assert.equal(new URL(call.url).hash, '');
    assert.equal(call.redirect, 'error');
    assert.equal(call.cache, 'no-store');
    assert.equal(call.headers.get('cookie'), 'session=alice');
    assert.equal(call.headers.get('authorization'), null);
    assert.equal(call.headers.get('x-user-uid'), null);
    assert.equal(call.headers.get('content-type'), 'application/json');
  }
  assert.deepEqual(JSON.parse(calls[0].body), { tool: 'search_orders', arguments: modelArguments });
  assert.deepEqual(JSON.parse(calls[1].body), { tool: 'update_order', arguments: { order_id: 'PO-1001', patch: { remark: 'ok' } } });
  assert.deepEqual(JSON.parse(calls[2].body), { tool: 'search_items', arguments: { query: '阀门' } });
});

test('one adapter keeps mixed catalog/orders sessions isolated between concurrent users', async () => {
  const calls = [];
  const userOf = (headers) => {
    const cookie = headers.get('cookie');
    return cookie?.includes('alice') ? 'alice' : cookie?.includes('bob') ? 'bob' : cookie?.includes('carol') ? 'carol' : 'anonymous';
  };
  const fetchImpl = async (url, init) => {
    const headers = new Headers(init.headers);
    const user = userOf(headers);
    const pathname = pathOf(url);
    calls.push({ url: String(url), pathname, headers, method: init.method ?? 'GET' });
    // Alice is slow, Bob is fast: shared mutable state would swap their surfaces.
    await new Promise((resolve) => setTimeout(resolve, user === 'alice' ? 30 : 3));
    if (pathname.endsWith('/api/ai/me')) {
      return jsonResponse({ data: user === 'alice' ? bothRolesIdentity : { ...ordersOnlyIdentity, uid: `u-${user}` } });
    }
    if (pathname.endsWith('/api/ai/catalog')) {
      if ((init.method ?? 'GET') === 'GET') return jsonResponse({ data: catalogManifest });
      const body = JSON.parse(init.body);
      return jsonResponse({ data: { seenUser: user, surface: 'catalog', tool: body.tool, arguments: body.arguments } });
    }
    if (pathname.endsWith('/api/ai/orders')) {
      if ((init.method ?? 'GET') === 'GET') return jsonResponse({ data: ordersManifest });
      const body = JSON.parse(init.body);
      return jsonResponse({ data: { seenUser: user, surface: 'orders', tool: body.tool, arguments: body.arguments } });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const adapter = createCatscoOaTools({ appBaseUrl: APP_BASE, fetchImpl });
  const alice = { currentUserRequest: makeRequest({ cookie: 'session=alice' }) };
  const bob = { currentUserRequest: makeRequest({ cookie: 'session=bob' }) };

  const [aliceTools, bobTools, aliceCatalog, bobOrder, aliceOrder, bobUpdate] = await Promise.all([
    adapter.listTools(alice),
    adapter.listTools(bob),
    adapter.execute('oa_catalog_search_items', { query: 'alice-only' }, alice),
    adapter.execute('oa_orders_search_orders', { query: 'bob-only' }, bob),
    adapter.execute('oa_orders_get_order', { order_id: 'PO-alice' }, alice),
    adapter.execute('oa_orders_update_order', { order_id: 'PO-bob', patch: {} }, bob)
  ]);

  assert.equal(aliceTools.length, 10);
  assert.equal(bobTools.length, 6);
  assert.deepEqual(bobTools.map((tool) => tool.name), [
    'oa_current_user',
    'oa_orders_search_orders',
    'oa_orders_get_order',
    'oa_orders_list_references',
    'oa_orders_create_order',
    'oa_orders_update_order'
  ]);
  assert.ok(bobTools.every((tool) => !tool.name.startsWith('oa_catalog_')));

  assert.deepEqual(aliceCatalog.data, { seenUser: 'alice', surface: 'catalog', tool: 'search_items', arguments: { query: 'alice-only' } });
  assert.deepEqual(bobOrder.data, { seenUser: 'bob', surface: 'orders', tool: 'search_orders', arguments: { query: 'bob-only' } });
  assert.deepEqual(aliceOrder.data, { seenUser: 'alice', surface: 'orders', tool: 'get_order', arguments: { order_id: 'PO-alice' } });
  assert.deepEqual(bobUpdate.data, { seenUser: 'bob', surface: 'orders', tool: 'update_order', arguments: { order_id: 'PO-bob', patch: {} } });

  assert.equal(calls.length, 9);
  for (const call of calls) {
    const cookie = call.headers.get('cookie');
    assert.ok(cookie === 'session=alice' || cookie === 'session=bob');
    assert.equal(call.headers.get('authorization'), null);
    assert.equal(call.headers.get('x-user-uid'), null);
    assert.equal(call.pathname.startsWith('/app42/api/ai/'), true);
  }
  // Bob has no catalog permission: none of his calls may reach the catalog manifest.
  const bobCalls = calls.filter((call) => call.headers.get('cookie') === 'session=bob');
  assert.ok(bobCalls.length > 0);
  assert.ok(bobCalls.every((call) => !call.pathname.endsWith('/api/ai/catalog')));
  // Alice has both permissions and every user's writes stay on the surface they selected.
  assert.equal(calls.filter((call) => call.pathname.endsWith('/api/ai/catalog') && call.headers.get('cookie') === 'session=alice').length, 2);
  assert.equal(calls.filter((call) => call.pathname.endsWith('/api/ai/orders')).length, 5);

  // A later orders-only user must not inherit Alice's catalog tools or credentials.
  const carol = { currentUserRequest: makeRequest({ cookie: 'session=carol' }) };
  const carolTools = await adapter.listTools(carol);
  assert.deepEqual(carolTools.map((tool) => tool.name), bobTools.map((tool) => tool.name));
  assert.equal(calls.at(-1).headers.get('cookie'), 'session=carol');
  assert.equal(calls.at(-1).headers.get('authorization'), null);
});

test('an invalid orders manifest is rejected as 502 without being partially registered', async () => {
  const { adapter } = recordingAdapter({
    handler: ({ url }) => (pathOf(url).endsWith('/api/ai/me')
      ? jsonResponse({ data: financeOrdersIdentity })
      : jsonResponse({ data: { tools: 'not-an-array' } }))
  });
  const error = await rejectsWith(
    adapter.listTools({ currentUserRequest: sessionRequest('finance') }),
    'INVALID_OA_RESPONSE',
    502
  );
  assert.match(error.message, /工具定义格式不正确/);
});

test('raw fetch failures containing secrets are converted to a generic 503 without leaking the cause', async () => {
  const secret = 'SECRET-cookie=session%3Dtop-secret; auth=Bearer leaks';
  const { adapter } = recordingAdapter({
    handler: () => {
      throw Object.assign(new Error(`connect failed: ${secret}`), { cause: new Error(secret), code: 'ECONNREFUSED' });
    }
  });

  const error = await rejectsWith(
    adapter.execute('oa_catalog_search_items', { query: 'x' }, { currentUserRequest: sessionRequest('alice') }),
    'OA_UNAVAILABLE',
    503
  );

  assert.match(error.message, /无法连接 OA/);
  assert.match(error.message, /勿盲目重复提交/);
  assert.doesNotMatch(error.message, /SECRET|session%3D|Bearer|ECONNREFUSED/i);
  assert.ok(!String(error.stack).includes(secret));
  assert.ok(!JSON.stringify(error).includes(secret));
  assert.equal(error.cause, undefined, 'the raw fetch error must not be attached as a cause');
});

test('OA 5xx is a generic 503 and invalid JSON/format responses are 502', async () => {
  const writeContext = { currentUserRequest: sessionRequest('alice') };

  {
    const { adapter } = recordingAdapter({
      handler: () => new Response('database exploded SECRET', { status: 500 })
    });
    const error = await rejectsWith(adapter.execute('oa_catalog_upsert_items', { items: [] }, writeContext), 'OA_UNAVAILABLE', 503);
    assert.ok(!error.message.includes('SECRET'));
  }

  {
    const { adapter } = recordingAdapter({
      handler: () => new Response('not-json SECRET', { status: 200, headers: { 'content-type': 'text/plain' } })
    });
    const error = await rejectsWith(adapter.execute('oa_current_user', {}, writeContext), 'INVALID_OA_RESPONSE', 502);
    assert.ok(!error.message.includes('SECRET'));
  }

  {
    const { adapter } = recordingAdapter({ handler: () => jsonResponse({ ok: true }) });
    await rejectsWith(adapter.execute('oa_current_user', {}, writeContext), 'INVALID_OA_RESPONSE', 502);
  }

  {
    const { adapter } = recordingAdapter({
      handler: ({ url }) => (pathOf(url).endsWith('/api/ai/me')
        ? jsonResponse({ data: adminIdentity })
        : jsonResponse({ data: { tools: 'not-an-array' } }))
    });
    const error = await rejectsWith(adapter.listTools(writeContext), 'INVALID_OA_RESPONSE', 502);
    assert.match(error.message, /工具定义格式不正确/);
  }
});

test('structured business errors keep only code/message/path and drop extra response fields', async () => {
  const secret = 'DO-NOT-LEAK';
  const { adapter } = recordingAdapter({
    handler: () => jsonResponse({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'query 不能为空',
        path: 'arguments.query',
        stack: secret,
        cookie: secret
      },
      data: secret,
      trace: secret
    }, 400)
  });

  const result = await adapter.execute(
    'oa_catalog_search_items',
    {},
    { currentUserRequest: sessionRequest('alice') }
  );

  assert.deepEqual(result, {
    error: { code: 'VALIDATION_ERROR', message: 'query 不能为空', path: 'arguments.query' }
  });
  assert.ok(!JSON.stringify(result).includes(secret));
});

test('successful data, including null data, is returned as { data } and non-structured errors fall back safely', async () => {
  {
    const { adapter } = recordingAdapter({ handler: () => jsonResponse({ data: null }) });
    assert.deepEqual(
      await adapter.execute('oa_current_user', {}, { currentUserRequest: sessionRequest('alice') }),
      { data: null }
    );
  }

  {
    const { adapter } = recordingAdapter({ handler: () => jsonResponse({ error: { unexpected: true } }, 400) });
    assert.deepEqual(
      await adapter.execute('oa_catalog_search_items', { query: 'x' }, { currentUserRequest: sessionRequest('alice') }),
      { error: { code: 'OA_REQUEST_FAILED', message: 'OA 请求失败' } }
    );
  }
});
