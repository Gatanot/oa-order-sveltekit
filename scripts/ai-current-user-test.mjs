/**
 * 集成测试：本机无密钥代录入口的本机边界，以及网页普通身份不被改变。
 *
 * 使用临时数据库、随机端口和只接受虚构 Cookie 的 mock Artifact 网关，真实启动：
 *   1) 网页 build（NODE_ENV=production，无任何 AI 密钥 env）；
 *   2) 独立 build-local/server.js（OA_LOCAL_PORT=0，从 stdout 解析实际 loopback 地址）。
 *
 * 验证：本机入口无需密钥/无 Cookie 即可成功；只监听 loopback；错误 Host/Origin(null)/
 * Sec-Fetch-Mode/Forwarded 一律 403；OPTIONS 405 且无 CORS；错误 Content-Type 415、
 * 超大请求体 413（含 chunked）；本机没有任何任意 SQL 接口；网页 /api/ai/* 不论 Cookie、
 * 密钥头或 X-Forwarded-* 一律 410 LOCAL_ENTRY_ONLY，不能把网页身份透传成本机能力；
 * 普通网页的匿名/员工/管理员权限保持不变。不接触真实凭据、真实网关或真实数据。
 *
 * 运行：node scripts/ai-current-user-test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { createCatscoOaTools } from '../src/lib/server/catsco-oa-tools.js';

const ADMIN = { uid: 826, username: 'catsco' };
const ORDINARY = { uid: 1201, username: 'ai-ordinary', name: '普通员工', role: 'executor' };
const VIEWER = new Map([['A', ADMIN], ['E', ORDINARY]]);
const APP_ID = 'oa-ai-current';
const directory = mkdtempSync(join(tmpdir(), 'oa-ai-current-user-'));
const databasePath = join(directory, 'oa.db');
const localEntryPath = join(process.cwd(), 'build-local', 'server.js');
const EXTERNAL_HEADER_VALUE = '127.0.0.1';

let mock;
let app;
let localApp;
const gatewayRequests = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** 虚构网关：只认 Cookie user=A（管理员）/user=E（普通员工），其余未登录。 */
function startMockGateway() {
  mock = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const cookie = request.headers.cookie || '';
    gatewayRequests.push({ pathname: url.pathname, app: url.searchParams.get('app'), cookie });
    if (url.pathname !== '/_gateway/me' || url.searchParams.get('app') !== APP_ID) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    const user = /(?:^|;\s*)user=([^;]+)/.exec(cookie)?.[1] || '';
    const viewer = VIEWER.get(user);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(viewer
      ? { authenticated: true, viewer: { id: `fictitious-${user}`, uid: viewer.uid, username: viewer.username }, topic_id: null }
      : { authenticated: false, viewer: null, topic_id: null }));
  });
  return new Promise((resolve, reject) => {
    mock.once('error', reject);
    mock.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${mock.address().port}`));
  });
}

/** 网页 build：不含任何 AI 密钥配置，普通网页身份仍走 Artifact 网关。 */
async function startApp(gatewayOrigin) {
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    OA_TEST_AUTH_BYPASS: '',
    ARTIFACT_APP_ID: APP_ID,
    ARTIFACT_GATEWAY_ORIGIN: gatewayOrigin,
    ORIGIN: origin,
    HOST: '127.0.0.1',
    PORT: String(port),
    DATABASE_PATH: databasePath
  };
  delete env.OA_TEST_UID;
  const child = spawn(process.execPath, ['build'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const instance = { child, origin, logs: '' };
  child.stdout.on('data', (chunk) => { instance.logs += chunk; });
  child.stderr.on('data', (chunk) => { instance.logs += chunk; });
  for (let index = 0; index < 100; index++) {
    if (child.exitCode !== null) throw new Error(`OA 网页服务提前退出（code ${child.exitCode}）\n${instance.logs}`);
    try {
      const response = await fetch(`${origin}/api/whoami`);
      if (response.status === 200) return instance;
    } catch { /* 端口尚未就绪 */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`OA 网页服务启动超时\n${instance.logs}`);
}

/** 独立本机入口：OA_LOCAL_PORT=0 由系统分配端口，从 stdout 解析实际 loopback 地址。 */
function startLocalEntry() {
  const env = { ...process.env, NODE_ENV: 'production', DATABASE_PATH: databasePath, OA_LOCAL_PORT: '0' };
  delete env.OA_TEST_UID;
  delete env.OA_TEST_AUTH_BYPASS;
  const child = spawn(process.execPath, [localEntryPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const instance = { child, origin: '', logs: '' };
  child.stdout.on('data', (chunk) => { instance.logs += chunk; });
  child.stderr.on('data', (chunk) => { instance.logs += chunk; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`本机入口启动超时\n${instance.logs}`));
    }, 10000);
    const check = () => {
      if (instance.origin) return;
      const match = /local entry listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(instance.logs);
      if (!match) return;
      instance.origin = match[1];
      clearTimeout(timer);
      resolve(instance);
    };
    child.stdout.on('data', check);
    child.once('exit', (code) => {
      if (instance.origin) return;
      clearTimeout(timer);
      reject(new Error(`本机入口提前退出（code ${code}）\n${instance.logs}`));
    });
    child.once('error', (reason) => {
      clearTimeout(timer);
      reject(reason);
    });
  });
}

async function request(origin, path, { method = 'GET', headers = {}, json } = {}) {
  const merged = new Headers(headers);
  if (json !== undefined) merged.set('content-type', 'application/json');
  const response = await fetch(`${origin}${path}`, {
    method, headers: merged, body: json === undefined ? undefined : JSON.stringify(json), redirect: 'manual'
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('json') ? await response.json() : await response.text();
  return { status: response.status, headers: response.headers, data };
}

/**
 * 本机入口请求必须用 node:http：fetch 会自动附加 sec-fetch-mode 等浏览器头，入口按设计拒绝。
 * 默认 Host 取实际 origin，可覆盖以验证 DNS rebinding / 代理边界。
 */
function rawRequest(base, path, { method = 'GET', headers = {}, body } = {}) {
  const url = new URL(path, base);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: { host: url.host, ...headers },
      timeout: 5000
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          text,
          json: () => JSON.parse(text)
        });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function assertNoCors(response, message) {
  for (const name of Object.keys(response.headers)) {
    assert.doesNotMatch(name, /^access-control-/i, `${message}：不应出现 CORS 响应头 ${name}`);
  }
}

function assertWebAiOffline(result, message) {
  assert.equal(result.status, 410, `${message}：HTTP ${result.status} ${JSON.stringify(result.data)}`);
  let body = result.data;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const payload = body && typeof body === 'object' ? body : {};
  const code = payload.error?.code ?? payload.code;
  assert.equal(code, 'LOCAL_ENTRY_ONLY', `${message}：错误码应为 LOCAL_ENTRY_ONLY，实际 ${code}`);
  const capabilityPayload = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  assert.ok(!Object.hasOwn(capabilityPayload, 'permissions') && !Object.hasOwn(capabilityPayload, 'tools'),
    `${message}：410 响应不应透传任何 AI 能力数据`);
}

/** 枚举可用于验证“非 loopback 连接失败”的本机外部 IPv4；没有则跳过该项。 */
function externalIpv4Addresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.internal) continue;
      if (entry.family !== 'IPv4' && entry.family !== 4) continue;
      if (!entry.address || entry.address.startsWith('169.254.')) continue;
      addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)];
}

/** 尝试连接指定的非 loopback 地址：任何拒连/超时/不可达都说明只绑定了 loopback。 */
function connectOnce(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (value) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish({ connected: false, reason: 'timeout' }), timeoutMs);
    socket.once('connect', () => finish({ connected: true }));
    socket.once('error', (reason) => finish({ connected: false, reason: reason.code || reason.message }));
  });
}

function withDb(fn) {
  const db = new Database(databasePath, { timeout: 5000 });
  try {
    db.pragma('busy_timeout = 5000');
    return fn(db);
  } finally {
    db.close();
  }
}

function waitForExit(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function stopApp(instance) {
  if (!instance?.child) return;
  if (instance.child.exitCode === null) instance.child.kill('SIGTERM');
  await waitForExit(instance.child);
}

try {
  const gatewayOrigin = await startMockGateway();
  app = await startApp(gatewayOrigin);
  const origin = app.origin;

  // 网页管理员 Cookie 初始化数据库，再写入一个普通员工档案（与 orders 测试一致的最小夹具）。
  let result = await request(origin, '/api/orders', { headers: { cookie: 'user=A' } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  withDb((db) => {
    const timestamp = new Date().toISOString();
    db.prepare(`INSERT INTO employees(catsco_uid,username,display_name,department,role,active,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`)
      .run(ORDINARY.uid, ORDINARY.username, ORDINARY.name, '执行', ORDINARY.role, 1, timestamp, timestamp);
  });

  localApp = await startLocalEntry();
  const localOrigin = localApp.origin;
  assert.match(localOrigin, /^http:\/\/127\.0\.0\.1:\d+$/, '本机入口应只打印 loopback 地址');

  // 1) 无需任何密钥/Cookie：node:http 直接访问本机 /api/ai/me 成功且只有 mode+permissions。
  const me = await rawRequest(localOrigin, '/api/ai/me');
  assert.equal(me.status, 200, me.text);
  const meBody = me.json();
  assert.equal(meBody.data?.mode, 'local_entry');
  assert.deepEqual(Object.keys(meBody.data).sort(), ['mode', 'permissions']);
  assert.deepEqual(Object.keys(meBody.data.permissions).sort(), ['catalog', 'orders']);
  for (const key of ['kind', 'agent_id', 'agentId', 'display_name', 'uid', 'username', 'role', 'active', 'cookie']) {
    assert.ok(!Object.hasOwn(meBody.data, key), `me 不应包含 ${key}`);
  }
  assert.doesNotMatch(me.text, /agent|员工|cookie|token|api[_-]?key/i, 'me 不应泄露 Agent/员工/密钥信息');
  assert.equal(me.headers['cache-control'], 'no-store');
  assertNoCors(me, '/api/ai/me');
  console.log('PASS 无密钥、无 Cookie 的本机请求直接得到 local_entry 身份与权限');

  // 2) 适配器无 key 也能用：入口信息、工具清单与共享数据库的只读查询都可用。
  const adapter = createCatscoOaTools({ appBaseUrl: `${localOrigin}/` });
  const info = await adapter.execute('oa_entry_info', {});
  assert.deepEqual(info.data, {
    mode: 'local_entry',
    permissions: { catalog: { read: true, manage: true }, orders: { read: true, create: true } }
  });
  const tools = (await adapter.listTools()).map((tool) => tool.name);
  for (const name of [
    'oa_entry_info', 'oa_catalog_list_sources', 'oa_orders_search_orders',
    'oa_orders_create_order', 'oa_orders_batch_create_orders'
  ]) {
    assert.ok(tools.includes(name), `缺少工具 ${name}: ${tools}`);
  }
  assert.ok(!tools.includes('oa_agent_info') && !tools.includes('oa_current_user'));
  const sources = await adapter.execute('oa_catalog_list_sources', { kind: 'quote', limit: 5 });
  const dbQuoteSources = withDb((db) => db.prepare("SELECT COUNT(*) FROM catalog_sources WHERE kind='quote' AND active=1").pluck().get());
  assert.equal(sources.data.total, dbQuoteSources, '本机入口应能读取网页初始化的同一临时数据库');
  const orders = await adapter.execute('oa_orders_search_orders', { limit: 5 });
  assert.equal(orders.data.total, withDb((db) => db.prepare('SELECT COUNT(*) FROM orders_simple').pluck().get()));
  assert.equal(orders.data.total, 0);
  console.log('PASS 适配器无 key 列出工具并共享同一临时数据库（无真实网关/真实数据）');

  // 3) Cookie / Agent 密钥头都不能改变本机身份，也不会被当作员工身份。
  for (const headers of [
    { cookie: 'user=A' },
    { cookie: 'user=E; session=whatever' },
    { 'x-oa-agent-key': 'x'.repeat(40) },
    { authorization: 'Bearer anything', cookie: 'user=A', 'x-oa-agent-key': 'y'.repeat(40) }
  ]) {
    const probe = await rawRequest(localOrigin, '/api/ai/me', { headers });
    assert.equal(probe.status, 200, probe.text);
    assert.deepEqual(Object.keys(probe.json().data).sort(), ['mode', 'permissions']);
    assert.equal(probe.json().data.mode, 'local_entry');
  }
  console.log('PASS 本机入口忽略 Cookie/Authorization/Agent 密钥头，仍返回 local_entry');

  // 4) 只监听 loopback：连接本机非 loopback IP 必须失败（没有可靠外部地址则跳过）。
  const localPort = Number(new URL(localOrigin).port);
  const externalAddresses = externalIpv4Addresses();
  if (externalAddresses.length === 0) {
    console.log('SKIP 无可靠非 loopback IPv4 地址，跳过非 loopback 连接失败验证');
  } else {
    for (const address of externalAddresses) {
      const outcome = await connectOnce(address, localPort);
      assert.equal(outcome.connected, false,
        `本机入口不应接受非 loopback 地址 ${address} 的连接（实际已连接）`);
    }
    console.log(`PASS 非 loopback 地址（${externalAddresses.join(', ')}）连接本机入口全部失败`);
  }

  // 5) 本机边界：错误 Host、Origin（含 null）、Fetch metadata、转发头一律 403。
  const forbiddenCases = [
    ['错误 Host', { host: 'evil.example.test:80' }],
    ['外网 Host', { host: `oa.example.test:${localPort}` }],
    ['Origin: null', { origin: 'null' }],
    ['网页 Origin', { origin: 'http://localhost:5173' }],
    ['Sec-Fetch-Mode', { 'sec-fetch-mode': 'cors' }],
    ['Sec-Fetch-Site', { 'sec-fetch-site': 'cross-site' }],
    ['X-Forwarded-For', { 'x-forwarded-for': EXTERNAL_HEADER_VALUE }],
    ['X-Forwarded-Host', { 'x-forwarded-host': 'oa.example.test' }],
    ['Forwarded', { forwarded: `for=${EXTERNAL_HEADER_VALUE}` }],
    ['X-Real-IP', { 'x-real-ip': EXTERNAL_HEADER_VALUE }]
  ];
  for (const [label, headers] of forbiddenCases) {
    const probe = await rawRequest(localOrigin, '/api/ai/me', { headers });
    assert.equal(probe.status, 403, `${label} 应返回 403，实际 ${probe.status} ${probe.text}`);
    assert.equal(probe.json().error?.code, 'FORBIDDEN', `${label} 错误码应为 FORBIDDEN`);
    assertNoCors(probe, label);
  }
  // 即使带着合法 Host 和 Cookie，转发头也不能放行。
  const forwardedWithCookie = await rawRequest(localOrigin, '/api/ai/me', {
    headers: { cookie: 'user=A', 'x-forwarded-for': EXTERNAL_HEADER_VALUE, 'x-forwarded-host': `127.0.0.1:${localPort}` }
  });
  assert.equal(forwardedWithCookie.status, 403, forwardedWithCookie.text);
  console.log('PASS 错误 Host / Origin(null) / Sec-Fetch-Mode / Forwarded 等请求头全部 403');

  // 6) OPTIONS 405 且无 CORS；预检不会放行任何来源。
  const options = await rawRequest(localOrigin, '/api/ai/orders', { method: 'OPTIONS' });
  assert.equal(options.status, 405, options.text);
  assert.equal(options.json().error?.code, 'METHOD_NOT_ALLOWED');
  assert.match(String(options.headers.allow || ''), /GET/);
  assert.match(String(options.headers.allow || ''), /POST/);
  assertNoCors(options, 'OPTIONS');
  const preflight = await rawRequest(localOrigin, '/api/ai/orders', {
    method: 'OPTIONS',
    headers: { origin: 'http://evil.example.test', 'access-control-request-method': 'POST' }
  });
  assert.equal(preflight.status, 403, preflight.text);
  assertNoCors(preflight, 'OPTIONS + Origin');
  const put = await rawRequest(localOrigin, '/api/ai/orders', { method: 'PUT' });
  assert.equal(put.status, 405, put.text);
  assertNoCors(put, 'PUT');
  console.log('PASS OPTIONS/PUT 返回 405 且无任何 CORS 响应头，带 Origin 的预检 403');

  // 7) Content-Type 415、声明超限 413、chunked 超过 1 MiB 也是 413。
  const wrongType = await rawRequest(localOrigin, '/api/ai/orders', {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"tool":"search_orders","arguments":{}}'
  });
  assert.equal(wrongType.status, 415, wrongType.text);
  assert.equal(wrongType.json().error?.code, 'UNSUPPORTED_MEDIA_TYPE');
  const noType = await rawRequest(localOrigin, '/api/ai/orders', { method: 'POST', body: '{}' });
  assert.equal(noType.status, 415, noType.text);
  const declaredTooLarge = await rawRequest(localOrigin, '/api/ai/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': String(1024 * 1024 + 10) }
  });
  assert.equal(declaredTooLarge.status, 413, declaredTooLarge.text);
  assert.equal(declaredTooLarge.json().error?.code, 'REQUEST_TOO_LARGE');

  const chunked = await new Promise((resolve, reject) => {
    const url = new URL('/api/ai/orders', localOrigin);
    let responded = null;
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { host: url.host, 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
      timeout: 5000
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        responded = { status: res.statusCode || 0, headers: res.headers, text };
        resolve(responded);
      });
      res.on('error', (reason) => {
        if (responded) return;
        reject(reason);
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (reason) => {
      // 入口在超限时会先回 413 再断开；已收到响应即视为成功。
      if (responded) return;
      reject(reason);
    });
    const chunk = Buffer.alloc(128 * 1024, 'a');
    for (let index = 0; index < 9; index++) req.write(chunk);
    req.end();
  });
  assert.equal(chunked.status, 413, chunked.text);
  assert.equal(JSON.parse(chunked.text).error?.code, 'REQUEST_TOO_LARGE');
  console.log('PASS 错误 Content-Type 415；声明/分块超过 1 MiB 的请求体返回 413');

  // 8) 本机没有任何任意 SQL/通用查询接口：未知路径 404，未知工具/字段被拒。
  for (const path of ['/api/sql', '/api/query', '/api/db', '/api/ai/sql', '/api/ai/query', '/api/ai/orders/sql', '/api/ai/me?sql=1']) {
    const probe = await rawRequest(localOrigin, path, { method: path.includes('?') ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: path.includes('?') ? undefined : '{"sql":"select 1"}' });
    assert.equal(probe.status, 404, `${path} 应 404，实际 ${probe.status} ${probe.text}`);
    assert.equal(probe.json().error?.code, 'NOT_FOUND');
  }
  for (const path of ['/', '/api/whoami', '/api/employees', '/api/orders']) {
    const probe = await rawRequest(localOrigin, path, { headers: { cookie: 'user=A' } });
    assert.equal(probe.status, 404, `${path} 不应由本机入口提供，实际 ${probe.status} ${probe.text}`);
  }
  for (const body of [
    { tool: 'sql', arguments: { sql: 'SELECT * FROM employees' } },
    { tool: 'query', arguments: { sql: 'SELECT 1' } },
    { tool: 'exec', arguments: { sql: 'DELETE FROM orders_simple' } },
    { tool: 'search_orders', arguments: { sql: 'SELECT 1' } }
  ]) {
    const probe = await rawRequest(localOrigin, '/api/ai/orders', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    const payload = probe.json();
    assert.ok(payload.error, `SQL 类请求必须被拒绝：${probe.text}`);
    assert.ok(['UNKNOWN_TOOL', 'VALIDATION_ERROR'].includes(payload.error.code), probe.text);
    assert.ok(!JSON.stringify(payload).includes('employees'), '错误响应不应泄露 SQL 或表结构');
  }
  const ordersManifest = await rawRequest(localOrigin, '/api/ai/orders');
  for (const tool of ordersManifest.json().data.tools) {
    assert.doesNotMatch(tool.name, /sql|query|exec|raw|db/i, `不应存在 SQL/通用查询工具 ${tool.name}`);
  }
  const catalogManifest = await rawRequest(localOrigin, '/api/ai/catalog');
  for (const tool of catalogManifest.json().data.tools) {
    assert.doesNotMatch(tool.name, /sql|query|exec|raw|db/i, `不应存在 SQL/通用查询工具 ${tool.name}`);
  }
  console.log('PASS 本机入口不存在任意 SQL/通用查询接口，未知路径 404、未知工具被拒');

  // 9) 网页 /api/ai/* 已下线：匿名/员工/管理员 Cookie、Agent 密钥头、X-Forwarded-* 一律 410。
  const webAiRequests = [
    ['匿名 GET /api/ai/me', '/api/ai/me', {}],
    ['匿名 GET /api/ai/orders', '/api/ai/orders', {}],
    ['员工 GET /api/ai/catalog', '/api/ai/catalog', { cookie: 'user=E' }],
    ['管理员 GET /api/ai/me', '/api/ai/me', { cookie: 'user=A' }],
    ['管理员 Agent 密钥头', '/api/ai/me', { cookie: 'user=A', 'x-oa-agent-key': 'z'.repeat(40) }],
    ['管理员 X-Forwarded-For', '/api/ai/me', { cookie: 'user=A', 'x-forwarded-for': EXTERNAL_HEADER_VALUE }],
    ['匿名 X-Forwarded-Host', '/api/ai/orders', { 'x-forwarded-host': `127.0.0.1:${localPort}` }],
    ['Forwarded 头', '/api/ai/orders', { cookie: 'user=A', forwarded: `for=${EXTERNAL_HEADER_VALUE}` }]
  ];
  const gatewayBeforeWebAi = gatewayRequests.length;
  for (const [label, path, headers] of webAiRequests) {
    assertWebAiOffline(await request(origin, path, { headers }), label);
  }
  for (const [label, headers] of [
    ['匿名 POST', {}],
    ['员工 POST', { cookie: 'user=E' }],
    ['管理员 POST + 转发头', { cookie: 'user=A', 'x-forwarded-for': EXTERNAL_HEADER_VALUE }]
  ]) {
    assertWebAiOffline(
      await request(origin, '/api/ai/catalog', { method: 'POST', headers, json: { tool: 'create_source', arguments: { kind: 'cost', owner_name: '网页透传库', dry_run: false } } }),
      `${label} /api/ai/catalog`
    );
  }
  assert.equal(gatewayRequests.length, gatewayBeforeWebAi, '网页 AI 路由下线后不应再访问 Artifact 网关');
  assert.equal(withDb((db) => db.prepare("SELECT COUNT(*) FROM catalog_sources WHERE owner_name='网页透传库'").pluck().get()), 0,
    '网页 AI 透传请求不得写入任何数据');
  console.log('PASS 网页 /api/ai/* 不论 Cookie/密钥头/Forwarded 均为 410，且不写库、不走网关');

  // 10) 普通网页身份与匿名权限保持不变：匿名 401，员工只读自己的订单、无员工管理权限，管理员不变。
  result = await request(origin, '/api/whoami');
  assert.equal(result.status, 200);
  assert.equal(result.data.authenticated, false, '匿名 whoami 仍为未登录');
  result = await request(origin, '/api/orders');
  assert.equal(result.status, 401, JSON.stringify(result.data));
  assert.equal(result.data.error?.code, 'UNAUTHORIZED');
  result = await request(origin, '/api/employees');
  assert.equal(result.status, 401, JSON.stringify(result.data));
  assert.equal(result.data.error?.code, 'UNAUTHORIZED');
  // X-Forwarded-* 不能让网页请求伪装成本机入口，也不能绕过普通网页认证。
  for (const path of ['/api/orders', '/api/employees']) {
    result = await request(origin, path, {
      headers: { 'x-forwarded-for': EXTERNAL_HEADER_VALUE, 'x-forwarded-host': `127.0.0.1:${localPort}`, 'x-real-ip': EXTERNAL_HEADER_VALUE }
    });
    assert.equal(result.status, 401, `${path} 带 X-Forwarded-* 仍应 401：${JSON.stringify(result.data)}`);
    assert.equal(result.data.error?.code, 'UNAUTHORIZED');
  }

  result = await request(origin, '/api/whoami', { headers: { cookie: 'user=E' } });
  assert.equal(result.status, 200);
  assert.equal(result.data.authenticated, true);
  assert.equal(result.data.uid, ORDINARY.uid);
  assert.equal(result.data.username, ORDINARY.username);
  result = await request(origin, '/api/orders', { headers: { cookie: 'user=E' } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.deepEqual(result.data.data, [], '普通员工只能看到自己的订单（此时为空）');
  result = await request(origin, '/api/employees', { headers: { cookie: 'user=E' } });
  assert.equal(result.status, 403, JSON.stringify(result.data));
  assert.equal(result.data.error?.code, 'FORBIDDEN');
  result = await request(origin, '/api/employees', {
    headers: { cookie: 'user=E', 'x-forwarded-for': EXTERNAL_HEADER_VALUE, 'x-forwarded-host': `127.0.0.1:${localPort}` }
  });
  assert.equal(result.status, 403, 'X-Forwarded-* 不能放大普通员工权限');
  assert.equal(result.data.error?.code, 'FORBIDDEN');

  result = await request(origin, '/api/whoami', { headers: { cookie: 'user=A' } });
  assert.equal(result.data.uid, ADMIN.uid);
  assert.equal(result.data.username, ADMIN.username);
  result = await request(origin, '/api/employees', { headers: { cookie: 'user=A' } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.ok(Array.isArray(result.data.data));
  assert.ok(result.data.data.some((employee) => employee.catsco_uid === ORDINARY.uid));
  assert.ok(Array.isArray(result.data.roles) && result.data.roles.includes('executor'));
  console.log('PASS 匿名/普通员工/管理员网页身份与权限保持不变，X-Forwarded-* 不能绕过普通网页认证');

  for (const call of gatewayRequests) {
    assert.equal(call.pathname, '/_gateway/me');
    assert.equal(call.app, APP_ID);
    assert.match(call.cookie, /^(|user=[AE])$/, `网关只应收到虚构 Cookie，实际：${call.cookie}`);
  }
  assert.ok(gatewayRequests.length > 0, '网页身份请求应已由 mock 网关校验');
  console.log(`PASS mock 网关仅收到虚构 Cookie（${gatewayRequests.length} 次）`);
} catch (error) {
  console.error('集成测试失败：', error);
  if (app?.logs) console.error('--- OA 网页服务日志 ---\n' + app.logs);
  if (localApp?.logs) console.error('--- 本机入口日志 ---\n' + localApp.logs);
  process.exitCode = 1;
} finally {
  await stopApp(localApp);
  await stopApp(app);
  if (mock) {
    await new Promise((resolve) => mock.close(resolve));
    mock.closeAllConnections?.();
  }
  rmSync(directory, { recursive: true, force: true });
}

if (process.exitCode !== 1) console.log('ALL PASS ai-current-user-test');
