/**
 * 集成测试：AI 资料库工具必须以“当前登录用户”执行，而不是模型/请求自报的 UID。
 *
 * 使用临时数据库、临时随机端口和一个仅接受虚构 Cookie user=A/B 的本地 mock 网关，
 * 真实启动 build 产物（NODE_ENV=production，关闭 OA_TEST_AUTH_BYPASS），
 * 通过 src/lib/server/catsco-oa-tools.js 适配器注入 currentUserRequest 调用 OA。
 * 不接触任何真实凭据、真实网关或真实数据。
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
import Database from 'better-sqlite3';

import { createCatscoOaTools, OaToolHostError } from '../src/lib/server/catsco-oa-tools.js';

const ADMIN = { uid: 826, username: 'catsco' };
const STAFF = { uid: 1001, username: 'staff' };
const APP_ID = 'oa-test';
const directory = mkdtempSync(join(tmpdir(), 'oa-ai-current-user-'));
const databasePath = join(directory, 'oa.db');

let mock;
let app;
let appLogs = '';
const gatewayRequests = [];

/** 取得一个空闲端口（用于 OA 服务），mock 网关直接监听 0。 */
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

/** 本地假网关：只认虚构 Cookie user=A / user=B，其余一律未登录。 */
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
    const viewer = user === 'A'
      ? { id: 'fictitious-a', uid: ADMIN.uid, username: ADMIN.username }
      : user === 'B'
        ? { id: 'fictitious-b', uid: STAFF.uid, username: STAFF.username }
        : null;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(viewer
      ? { authenticated: true, viewer, topic_id: null }
      : { authenticated: false, viewer: null, topic_id: null }));
  });
  return new Promise((resolve, reject) => {
    mock.once('error', reject);
    mock.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${mock.address().port}`));
  });
}

async function waitForServer(origin) {
  for (let index = 0; index < 100; index++) {
    if (app.exitCode !== null) throw new Error(`OA 服务提前退出（code ${app.exitCode}）\n${appLogs}`);
    try {
      const response = await fetch(`${origin}/api/whoami`);
      // 未登录时 whoami 返回 guest（200），只看服务是否已经能响应。
      if (response.status === 200) return;
    } catch { /* 端口尚未就绪，继续等待 */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`OA 服务启动超时\n${appLogs}`);
}

/** 直接 HTTP 请求，避免依赖适配器，用于验证裸请求/伪造头。 */
async function request(origin, path, { method = 'GET', headers = {}, json } = {}) {
  const merged = new Headers(headers);
  if (json !== undefined) merged.set('content-type', 'application/json');
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: merged,
    body: json === undefined ? undefined : JSON.stringify(json),
    redirect: 'manual'
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('json') ? await response.json() : await response.text();
  return { status: response.status, data };
}

/** 用临时数据库连接读取/修改员工与审计数据；用完即关，避免影响被测服务。 */
function withDb(fn) {
  const db = new Database(databasePath, { timeout: 5000 });
  try {
    db.pragma('busy_timeout = 5000');
    return fn(db);
  } finally {
    db.close();
  }
}

/** 通过适配器执行工具，并断言抛出的 OaToolHostError 代码/状态。 */
async function rejectsWith(promise, code, status) {
  await assert.rejects(promise, (reason) => {
    assert.ok(reason instanceof OaToolHostError, `应抛出 OaToolHostError，实际：${reason}`);
    assert.equal(reason.code, code);
    if (status !== undefined) assert.equal(reason.status, status);
    return true;
  });
}

function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

let adapter;
let adminContext;
let staffContext;

try {
  const gatewayOrigin = await startMockGateway();
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

  app = spawn(process.execPath, ['build'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  app.stdout.on('data', (chunk) => { appLogs += chunk; });
  app.stderr.on('data', (chunk) => { appLogs += chunk; });
  await waitForServer(origin);

  adapter = createCatscoOaTools({ appBaseUrl: `${origin}/` });
  adminContext = { currentUserRequest: new Request(`${origin}/chat`, { headers: { cookie: 'user=A' } }) };
  staffContext = { currentUserRequest: new Request(`${origin}/chat`, { headers: { cookie: 'user=B' } }) };

  // 1) 先由 admin me 初始化数据库（首次访问会执行迁移）。
  let result = await adapter.execute('oa_current_user', {}, adminContext);
  assert.equal(result.data.uid, ADMIN.uid, '管理员 me 应返回固定管理员 UID');
  assert.equal(result.data.username, ADMIN.username);
  assert.equal(result.data.role, 'admin');
  assert.equal(result.data.active, true);
  assert.deepEqual(result.data.permissions.catalog, { read: true, manage: true });
  console.log('PASS admin me 初始化数据库并返回 826/catsco/admin');

  // 2) 数据库中预先登记 staff（executor、在职），之后 user=B 解析为员工身份。
  withDb((db) => {
    const timestamp = new Date().toISOString();
    db.prepare(`INSERT INTO employees(catsco_uid,username,display_name,department,role,active,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(STAFF.uid, STAFF.username, '测试员工', '', 'executor', 1, timestamp, timestamp);
  });

  // 3) 两个用户各自 me，确认身份来自网关会话而不是参数。
  result = await adapter.execute('oa_current_user', {}, staffContext);
  assert.equal(result.data.uid, STAFF.uid);
  assert.equal(result.data.username, STAFF.username);
  assert.equal(result.data.role, 'executor');
  assert.equal(result.data.active, true);
  assert.deepEqual(result.data.permissions.catalog, { read: true, manage: true });
  console.log('PASS staff me 返回 1001/staff/executor');

  // 4) 两个用户分别实际新建资料库（dry_run=false），且审计记录各自 UID。
  result = await adapter.execute('oa_catalog_create_source', { kind: 'cost', owner_name: 'AI-CURRENT-管理员库', dry_run: false }, adminContext);
  assert.equal(result.data.dry_run, false);
  assert.equal(result.data.source.owner_name, 'AI-CURRENT-管理员库');
  result = await adapter.execute('oa_catalog_create_source', { kind: 'cost', owner_name: 'AI-CURRENT-员工库', dry_run: false }, staffContext);
  assert.equal(result.data.dry_run, false);
  assert.equal(result.data.source.owner_name, 'AI-CURRENT-员工库');

  const audits = withDb((db) => db.prepare(`SELECT actor_uid, actor_name, action, entity_type, detail_json
    FROM audit_logs WHERE entity_type='catalog_source' ORDER BY created_at`).all());
  assert.equal(audits.length, 2, '两次写入应各产生一条资料库审计');
  assert.deepEqual(audits.map((row) => row.actor_uid).sort((a, b) => a - b), [ADMIN.uid, STAFF.uid], '审计 UID 应分别对应两个用户');
  for (const row of audits) {
    assert.equal(row.action, 'create');
    assert.equal(JSON.parse(row.detail_json).channel, 'ai_tool');
  }
  // 数据库初始化会写入演示资料库，这里只断言本次测试创建的两个来源。
  const owners = withDb((db) => db.prepare("SELECT owner_name FROM catalog_sources WHERE owner_name LIKE 'AI-CURRENT-%' ORDER BY owner_name").pluck().all());
  assert.deepEqual(owners, ['AI-CURRENT-员工库', 'AI-CURRENT-管理员库']);
  console.log('PASS 两个用户分别 create_source，审计 UID 分别为 826 / 1001');

  // 5) 停用 staff 后，同一个旧 context 再写应被 403 拒绝。
  withDb((db) => db.prepare('UPDATE employees SET active=0, updated_at=? WHERE catsco_uid=?')
    .run(new Date().toISOString(), STAFF.uid));
  await rejectsWith(
    adapter.execute('oa_catalog_create_source', { kind: 'cost', owner_name: 'AI-CURRENT-停用库', dry_run: false }, staffContext),
    'FORBIDDEN', 403
  );
  assert.equal(withDb((db) => db.prepare("SELECT COUNT(*) FROM catalog_sources WHERE owner_name='AI-CURRENT-停用库'").pluck().get()), 0, '停用用户不得写入');
  console.log('PASS staff 停用后旧 context 写入返回 403');

  // 6) 重新启用但改成 finance：资料库无权限，写仍应 403。
  withDb((db) => db.prepare('UPDATE employees SET active=1, role=?, updated_at=? WHERE catsco_uid=?')
    .run('finance', new Date().toISOString(), STAFF.uid));
  await rejectsWith(
    adapter.execute('oa_catalog_create_source', { kind: 'cost', owner_name: 'AI-CURRENT-财务库', dry_run: false }, staffContext),
    'FORBIDDEN', 403
  );
  assert.equal(withDb((db) => db.prepare("SELECT COUNT(*) FROM catalog_sources WHERE owner_name='AI-CURRENT-财务库'").pluck().get()), 0, '财务用户不得写入资料库');
  result = await adapter.execute('oa_current_user', {}, staffContext);
  assert.equal(result.data.role, 'finance');
  assert.deepEqual(result.data.permissions.catalog, { read: false, manage: false });
  console.log('PASS staff 改为 finance 后写入返回 403，且 me 显示无资料库权限');

  // 7) 无 Cookie、仅伪造 x-user-uid 应被拒绝（不能自报 UID）。
  result = await request(origin, '/api/ai/me', { headers: { 'x-user-uid': String(ADMIN.uid) } });
  assert.equal(result.status, 401, JSON.stringify(result.data));
  assert.equal(result.data.error?.code, 'LOGIN_REQUIRED');
  result = await request(origin, '/api/ai/catalog', {
    method: 'POST',
    headers: { 'x-user-uid': String(ADMIN.uid) },
    json: { tool: 'create_source', arguments: { kind: 'cost', owner_name: 'AI-CURRENT-伪造头库', dry_run: false } }
  });
  assert.equal(result.status, 401, JSON.stringify(result.data));
  assert.equal(result.data.error?.code, 'LOGIN_REQUIRED');
  assert.equal(withDb((db) => db.prepare("SELECT COUNT(*) FROM catalog_sources WHERE owner_name='AI-CURRENT-伪造头库'").pluck().get()), 0, '伪造头不得写入');
  console.log('PASS 无 Cookie + x-user-uid:826 被 401 LOGIN_REQUIRED 拒绝');

  // 8) 直接裸请求 /api/ai/me?uid=826 不认证应 401 LOGIN_REQUIRED。
  result = await request(origin, `/api/ai/me?uid=${ADMIN.uid}`);
  assert.equal(result.status, 401, JSON.stringify(result.data));
  assert.equal(result.data.error?.code, 'LOGIN_REQUIRED');
  console.log('PASS 裸请求 /api/ai/me?uid=826 返回 401 LOGIN_REQUIRED');

  // 9) create_source 参数里夹带 uid=826 必须被拒绝，且不落库。
  result = await adapter.execute('oa_catalog_create_source', { kind: 'cost', owner_name: 'AI-CURRENT-参数UID库', uid: ADMIN.uid, dry_run: false }, adminContext);
  assert.equal(result.error?.code, 'VALIDATION_ERROR', JSON.stringify(result));
  assert.equal(result.error?.path, 'arguments.uid');
  assert.equal(withDb((db) => db.prepare("SELECT COUNT(*) FROM catalog_sources WHERE owner_name='AI-CURRENT-参数UID库'").pluck().get()), 0, '参数中的 uid 不得生效');
  console.log('PASS create_source arguments.uid=826 被 VALIDATION_ERROR 拒绝');

  // mock 网关只应由 OA 服务以虚构会话访问，没有真实凭据。
  assert.ok(gatewayRequests.length > 0);
  for (const gatewayRequest of gatewayRequests) {
    assert.equal(gatewayRequest.pathname, '/_gateway/me');
    assert.equal(gatewayRequest.app, APP_ID);
    assert.match(gatewayRequest.cookie, /^(|user=[AB])$/, `网关只应收到虚构 Cookie，实际：${gatewayRequest.cookie}`);
  }
  console.log(`PASS mock 网关仅收到虚构 Cookie（${gatewayRequests.length} 次）`);
} catch (error) {
  console.error('集成测试失败：', error);
  if (appLogs) console.error('--- OA 服务日志 ---\n' + appLogs);
  process.exitCode = 1;
} finally {
  // 先停 OA（触发网关请求的进程），再关 mock，最后删除临时目录。
  if (app) {
    if (app.exitCode === null) app.kill('SIGTERM');
    await waitForExit(app);
    if (app.exitCode === null) {
      app.kill('SIGKILL');
      await waitForExit(app);
    }
  }
  if (mock) {
    await new Promise((resolve) => mock.close(resolve));
    mock.closeAllConnections?.();
  }
  rmSync(directory, { recursive: true, force: true });
}

if (process.exitCode !== 1) console.log('ALL PASS ai-current-user-test');
