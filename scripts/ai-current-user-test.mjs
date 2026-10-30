/**
 * 集成测试：AI 服务身份只认 X-OA-Agent-Key，不再回退网页登录态。
 *
 * 使用临时数据库、随机端口和一个只接受虚构 Cookie 的 mock Artifact 网关，
 * 真实启动 build 产物（NODE_ENV=production，关闭 OA_TEST_AUTH_BYPASS）。
 * 验证：无 key/错误 key/Artifact Cookie 都不能进入 AI 路由；有效 key 无 Cookie
 * 返回 service_agent；key 不能访问员工/普通订单 API；AI 请求不会访问 Artifact 网关。
 * 不接触真实凭据、真实网关或真实数据，finally 关闭服务并删除临时目录。
 *
 * 运行：node scripts/ai-current-user-test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCatscoOaTools } from '../src/lib/server/catsco-oa-tools.js';

const ADMIN = { uid: 826, username: 'catsco' };
const TEST_KEY = 'oa-ai-current-test-key-' + '0123456789abcdef'.repeat(2);
const WRONG_KEY = 'wrong-agent-key-' + 'fedcba9876543210'.repeat(2);
const APP_ID = 'oa-ai-current';
const AGENT_ID = 'shared-test';
const directory = mkdtempSync(join(tmpdir(), 'oa-ai-current-user-'));
const databasePath = join(directory, 'oa.db');

let mock;
let app;
let disabledApp;
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

/** 虚构网关：只认 Cookie user=A（管理员），其余都视为未登录。 */
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
    const viewer = user === 'A' ? ADMIN : null;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(viewer
      ? { authenticated: true, viewer: { id: 'fictitious-a', uid: viewer.uid, username: viewer.username }, topic_id: null }
      : { authenticated: false, viewer: null, topic_id: null }));
  });
  return new Promise((resolve, reject) => {
    mock.once('error', reject);
    mock.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${mock.address().port}`));
  });
}

async function startApp(gatewayOrigin, extraEnv) {
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
    DATABASE_PATH: databasePath,
    ...extraEnv
  };
  delete env.OA_TEST_UID;
  const child = spawn(process.execPath, ['build'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const instance = { child, origin, logs: '' };
  child.stdout.on('data', (chunk) => { instance.logs += chunk; });
  child.stderr.on('data', (chunk) => { instance.logs += chunk; });
  for (let index = 0; index < 100; index++) {
    if (child.exitCode !== null) throw new Error(`OA 服务提前退出（code ${child.exitCode}）\n${instance.logs}`);
    try {
      const response = await fetch(`${origin}/api/whoami`);
      if (response.status === 200) return instance;
    } catch { /* 端口尚未就绪 */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`OA 服务启动超时\n${instance.logs}`);
}

async function request(origin, path, { method = 'GET', headers = {}, json } = {}) {
  const merged = new Headers(headers);
  if (json !== undefined) merged.set('content-type', 'application/json');
  const response = await fetch(`${origin}${path}`, {
    method, headers: merged, body: json === undefined ? undefined : JSON.stringify(json), redirect: 'manual'
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('json') ? await response.json() : await response.text();
  return { status: response.status, data };
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
  app = await startApp(gatewayOrigin, { OA_AI_SERVICE_KEY: TEST_KEY, OA_AI_SERVICE_ID: AGENT_ID, OA_AI_SERVICE_NAME: '共享测试 Agent' });
  const origin = app.origin;
  const adapter = createCatscoOaTools({ appBaseUrl: `${origin}/`, apiKey: TEST_KEY });
  const adminCookie = { cookie: 'user=A' };
  const keyHeaders = { 'x-oa-agent-key': TEST_KEY };
  const gatewayBeforeAi = gatewayRequests.length;

  // 1) 网页管理员 Cookie 没有 Agent key 也不能进入 AI 路由。
  let result = await request(origin, '/api/ai/me', { headers: adminCookie });
  assert.equal(result.status, 401, JSON.stringify(result.data));
  assert.equal(result.data.error?.code, 'AGENT_AUTH_REQUIRED');
  result = await request(origin, '/api/ai/orders', { headers: adminCookie });
  assert.equal(result.status, 401, JSON.stringify(result.data));
  assert.equal(result.data.error?.code, 'AGENT_AUTH_REQUIRED');
  console.log('PASS 网页 admin Cookie 无 key 访问 AI 路由返回 401');

  // 2) 错误 key、仅 Authorization 也不能通过。
  result = await request(origin, '/api/ai/me', { headers: { ...adminCookie, 'x-oa-agent-key': WRONG_KEY } });
  assert.equal(result.status, 401, JSON.stringify(result.data));
  assert.equal(result.data.error?.code, 'AGENT_AUTH_REQUIRED');
  result = await request(origin, '/api/ai/me', { headers: { authorization: `Bearer ${TEST_KEY}` } });
  assert.equal(result.status, 401, JSON.stringify(result.data));
  assert.equal(result.data.error?.code, 'AGENT_AUTH_REQUIRED');
  console.log('PASS 错误 key / 仅 Authorization 均被 401 拒绝');

  // 3) 有效 key 无 Cookie：/api/ai/me 返回服务 Agent，而不是任何员工。
  const info = await adapter.execute('oa_agent_info', {});
  assert.equal(info.data.kind, 'service_agent');
  assert.equal(info.data.agent_id, AGENT_ID);
  assert.equal(info.data.display_name, '共享测试 Agent');
  assert.deepEqual(info.data.permissions.catalog, { read: true, manage: true });
  assert.deepEqual(info.data.permissions.orders, { read: true, create: true, view_all: true, manage_all: true, edit_scope: 'all' });
  for (const key of ['uid', 'user_uid', 'username', 'user']) assert.ok(!(key in info.data), `响应不应包含 ${key}`);
  const tools = (await adapter.listTools()).map((tool) => tool.name);
  for (const name of ['oa_agent_info', 'oa_current_user', 'oa_catalog_list_sources', 'oa_orders_create_order', 'oa_orders_batch_create_orders']) {
    assert.ok(tools.includes(name), `缺少工具 ${name}: ${tools}`);
  }
  console.log('PASS 有效 key 无 Cookie 返回 service_agent / shared-test，无员工 uid');

  // 4) 有效 key 即使携带网页 admin Cookie，仍只返回服务 Agent。
  result = await request(origin, '/api/ai/me', { headers: { ...adminCookie, ...keyHeaders } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data?.kind, 'service_agent');
  assert.equal(result.data.data?.agent_id, AGENT_ID);
  assert.ok(!('uid' in (result.data.data || {})));
  console.log('PASS 有效 key + 网页 Cookie 仍是 service_agent');

  // 5) 上面所有 AI 请求都没有访问 Artifact 网关（AI 身份不依赖浏览器会话）。
  assert.equal(gatewayRequests.length, gatewayBeforeAi, 'AI 请求不应访问 Artifact gateway');
  console.log(`PASS AI 请求未访问 Artifact 网关（网关调用保持 ${gatewayBeforeAi} 次）`);

  // 6) Agent key 不能代替网页身份访问员工/普通订单 API。
  result = await request(origin, '/api/employees', { headers: keyHeaders });
  assert.equal(result.status, 401, JSON.stringify(result.data));
  assert.equal(result.data.error?.code, 'UNAUTHORIZED');
  result = await request(origin, '/api/orders', { headers: keyHeaders });
  assert.equal(result.status, 401, JSON.stringify(result.data));
  assert.equal(result.data.error?.code, 'UNAUTHORIZED');
  console.log('PASS Agent key 无 Cookie 不能访问 /api/employees 或 /api/orders');

  // 7) 网页 Cookie 身份仍独立可用（与 Agent key 完全分离）。
  result = await request(origin, '/api/employees', { headers: adminCookie });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.ok(Array.isArray(result.data.data));
  result = await request(origin, '/api/orders', { headers: adminCookie });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.ok(Array.isArray(result.data.data));
  console.log('PASS 网页 admin Cookie 仍可独立访问员工与订单 API');

  // 8) 未配置服务 key 的子服务即使收到任意 key 也关闭 AI 路由。
  disabledApp = await startApp(gatewayOrigin, { OA_AI_SERVICE_KEY: '', OA_AI_SERVICE_ID: '' });
  result = await request(disabledApp.origin, '/api/ai/me', { headers: keyHeaders });
  assert.equal(result.status, 401, JSON.stringify(result.data));
  result = await request(disabledApp.origin, '/api/ai/me', { headers: { ...adminCookie, ...keyHeaders } });
  assert.equal(result.status, 401, JSON.stringify(result.data));
  console.log('PASS 未配置 OA_AI_SERVICE_KEY 的子服务对 AI 路由返回 401');

  for (const call of gatewayRequests) {
    assert.equal(call.pathname, '/_gateway/me');
    assert.equal(call.app, APP_ID);
    assert.match(call.cookie, /^(|user=A)$/, `网关只应收到虚构 Cookie，实际：${call.cookie}`);
  }
  console.log(`PASS mock 网关仅收到虚构 Cookie（${gatewayRequests.length} 次）`);
} catch (error) {
  console.error('集成测试失败：', error);
  if (app?.logs) console.error('--- OA 服务日志 ---\n' + app.logs);
  if (disabledApp?.logs) console.error('--- 禁用配置服务日志 ---\n' + disabledApp.logs);
  process.exitCode = 1;
} finally {
  await stopApp(disabledApp);
  await stopApp(app);
  if (mock) {
    await new Promise((resolve) => mock.close(resolve));
    mock.closeAllConnections?.();
  }
  rmSync(directory, { recursive: true, force: true });
}

if (process.exitCode !== 1) console.log('ALL PASS ai-current-user-test');
