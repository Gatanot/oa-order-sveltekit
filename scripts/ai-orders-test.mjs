/**
 * 集成测试：AI 订单工具契约（/api/ai/orders）与当前用户身份链。
 *
 * 使用临时数据库、临时随机端口和一个只接受虚构 Cookie user=A..E 的本地 mock 网关，
 * 真实启动 build 产物（NODE_ENV=production，关闭 OA_TEST_AUTH_BYPASS），
 * 通过 src/lib/server/catsco-oa-tools.js 适配器注入 currentUserRequest 调用 OA。
 * 不接触任何真实凭据、真实网关或真实数据；finally 关闭服务/网关并删除临时目录。
 *
 * 运行：node scripts/ai-orders-test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { createCatscoOaTools } from '../src/lib/server/catsco-oa-tools.js';

const ADMIN = { uid: 826, username: 'catsco' };
const EXECUTOR = { uid: 1001, username: 'ai-exec' };
const DESIGNER = { uid: 1002, username: 'ai-designer' };
const FINANCE = { uid: 1003, username: 'ai-finance' };
const UNRELATED = { uid: 1004, username: 'ai-unrelated' };
const PLANNER = { uid: 1005, username: 'ai-planner' };
const INACTIVE_DESIGNER = { uid: 1006, username: 'ai-inactive' };
const APP_ID = 'oa-test';
const COOKIE = { admin: 'user=A', executor: 'user=B', designer: 'user=C', finance: 'user=D', unrelated: 'user=E' };
const VIEWER = new Map([['A', ADMIN], ['B', EXECUTOR], ['C', DESIGNER], ['D', FINANCE], ['E', UNRELATED]]);

const CUSTOMER_ID = 'cust-ai-orders';
const PROJECT_ID = 'proj-ai-orders';
const QUOTE_ITEM_ID = 'quote-ai-orders';
const COST_ITEM_ID = 'cost-ai-orders';

const directory = mkdtempSync(join(tmpdir(), 'oa-ai-orders-'));
const databasePath = join(directory, 'oa.db');

let mock;
let app;
let appLogs = '';
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

/** 本地假网关：只认虚构 Cookie user=A..E，其余一律未登录。 */
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

async function waitForServer(origin) {
  for (let index = 0; index < 100; index++) {
    if (app.exitCode !== null) throw new Error(`OA 服务提前退出（code ${app.exitCode}）\n${appLogs}`);
    try {
      const response = await fetch(`${origin}/api/whoami`);
      if (response.status === 200) return;
    } catch { /* 端口尚未就绪，继续等待 */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`OA 服务启动超时\n${appLogs}`);
}

async function api(origin, cookie, path, { method = 'GET', json } = {}) {
  const headers = { cookie };
  if (json !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${origin}${path}`, {
    method, headers, body: json === undefined ? undefined : JSON.stringify(json), redirect: 'manual'
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('json') ? await response.json() : await response.text();
  return { status: response.status, data };
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

const orderCount = () => withDb((db) => db.prepare('SELECT COUNT(*) FROM orders_simple').pluck().get());
const auditCount = () => withDb((db) => db.prepare("SELECT COUNT(*) FROM audit_logs WHERE entity_type='order'").pluck().get());

function expectOk(response) {
  assert.ok(response.status >= 200 && response.status < 300, `期望成功，实际 ${response.status}: ${JSON.stringify(response.data)}`);
  assert.equal(response.data.error, undefined, JSON.stringify(response.data));
  return response.data.data;
}

function expectError(response, status, code, path) {
  assert.equal(response.status, status, `期望 HTTP ${status}，实际 ${response.status}: ${JSON.stringify(response.data)}`);
  assert.equal(response.data.error?.code, code, JSON.stringify(response.data));
  if (path !== undefined) assert.equal(response.data.error?.path, path, JSON.stringify(response.data));
}

function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

/** 测试数据：客户、项目、员工、报价/成本资料库条目，全部写入临时数据库。 */
function seedDatabase() {
  withDb((db) => {
    const timestamp = new Date().toISOString();
    db.prepare('INSERT INTO customers_simple(id,name,contact,created_at) VALUES(?,?,?,?)')
      .run(CUSTOMER_ID, 'AI 测试客户', '客户联系人', timestamp);
    db.prepare('INSERT INTO projects_simple(id,customer_id,name,owner,status,created_at) VALUES(?,?,?,?,?,?)')
      .run(PROJECT_ID, CUSTOMER_ID, 'AI 测试项目', '项目负责人', '进行中', timestamp);
    const employees = [
      [EXECUTOR.uid, EXECUTOR.username, 'AI执行', '执行', 'executor', 1],
      [DESIGNER.uid, DESIGNER.username, 'AI设计', '设计', 'designer', 1],
      [FINANCE.uid, FINANCE.username, 'AI财务', '内务', 'finance', 1],
      [UNRELATED.uid, UNRELATED.username, 'AI无关执行', '执行', 'executor', 1],
      [PLANNER.uid, PLANNER.username, 'AI策划', '策划', 'planner', 1],
      [INACTIVE_DESIGNER.uid, INACTIVE_DESIGNER.username, 'AI停用设计', '设计', 'designer', 0]
    ];
    const insertEmployee = db.prepare(`INSERT INTO employees(catsco_uid,username,display_name,department,role,active,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`);
    for (const row of employees) insertEmployee.run(...row, timestamp, timestamp);
    db.prepare('INSERT INTO catalog_quote_items(id,active,name,unit,price_incl_tax,created_at) VALUES(?,?,?,?,?,?)')
      .run(QUOTE_ITEM_ID, 1, 'AI 报价条目', '件', 9999, timestamp);
    db.prepare('INSERT INTO catalog_cost_items(id,active,name,unit,cost_unit,created_at) VALUES(?,?,?,?,?,?)')
      .run(COST_ITEM_ID, 1, 'AI 成本条目', '项', 8888, timestamp);
  });
}

const lineProduct = (overrides = {}) => ({
  catalog_id: QUOTE_ITEM_ID, name: '订单产品', specification: '产品规格', remark: '行备注',
  unit: '件', quantity: 2, unit_price: '12.50', ...overrides
});
const lineCost = (overrides = {}) => ({
  catalog_id: COST_ITEM_ID, name: '订单成本', vendor: '成本供应商', unit: '项',
  quantity: 1, unit_price: '5.00', ...overrides
});
const orderPayload = (overrides = {}) => ({
  project_id: PROJECT_ID, order_date: '2024-05-01', delivery_date: '2024-06-01',
  contact: '联系人甲', customer_department: '市场部', execution_company: '执行公司一',
  note: '初始备注', designer_uid: DESIGNER.uid, products: [lineProduct()], costs: [lineCost()],
  ...overrides
});

let adapter;
const context = (cookie) => ({ currentUserRequest: new Request('http://oa.local/chat', { headers: { cookie } }) });

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

  // 1) admin me 初始化数据库，再写入测试客户/项目/员工/资料库条目。
  let result = expectOk(await api(origin, COOKIE.admin, '/api/ai/me'));
  assert.equal(result.uid, ADMIN.uid);
  assert.equal(result.role, 'admin');
  assert.deepEqual(result.permissions.orders, { read: true, create: true, view_all: true, manage_all: true, edit_scope: 'all' });
  seedDatabase();
  console.log('PASS admin me 初始化数据库，permissions.orders 为全量');

  // 2) 各角色的订单权限来自真实员工档案，不是参数自报。
  const expected = [
    [COOKIE.executor, EXECUTOR, 'executor', { read: true, create: true, view_all: false, manage_all: false, edit_scope: 'participating' }],
    [COOKIE.designer, DESIGNER, 'designer', { read: true, create: false, view_all: false, manage_all: false, edit_scope: 'participating' }],
    [COOKIE.finance, FINANCE, 'finance', { read: true, create: false, view_all: true, manage_all: false, edit_scope: 'participating' }],
    [COOKIE.unrelated, UNRELATED, 'executor', { read: true, create: true, view_all: false, manage_all: false, edit_scope: 'participating' }]
  ];
  for (const [cookie, user, role, orders] of expected) {
    const me = expectOk(await api(origin, cookie, '/api/ai/me'));
    assert.equal(me.uid, user.uid);
    assert.equal(me.role, role);
    assert.deepEqual(me.permissions.orders, orders, `${role} 订单权限不符`);
  }
  console.log('PASS 1001/1002/1003/1004 的 me 与 permissions.orders 正确');

  // 3) 服务端 manifest 按身份过滤 create_order；适配器再按 me 权限过滤。
  const manifestNames = async (cookie) => expectOk(await api(origin, cookie, '/api/ai/orders')).tools.map((tool) => tool.name);
  assert.deepEqual((await manifestNames(COOKIE.admin)).sort(), ['create_order', 'get_order', 'list_references', 'search_orders', 'update_order']);
  for (const cookie of [COOKIE.finance, COOKIE.designer]) {
    const names = await manifestNames(cookie);
    assert.ok(!names.includes('create_order'), `不允许创建的身份不得看到 create_order：${names}`);
    for (const name of ['get_order', 'list_references', 'search_orders']) assert.ok(names.includes(name), `${name} 不应被过滤：${names}`);
  }
  assert.ok((await manifestNames(COOKIE.designer)).includes('update_order'), '参与的 designer 应能拿到 update_order');

  const financeTools = (await adapter.listTools(context(COOKIE.finance))).map((tool) => tool.name);
  for (const name of ['oa_current_user', 'oa_orders_search_orders', 'oa_orders_get_order', 'oa_orders_list_references']) {
    assert.ok(financeTools.includes(name), `finance 缺少 ${name}: ${financeTools}`);
  }
  assert.ok(!financeTools.includes('oa_orders_create_order'));
  const adminTools = await adapter.listTools(context(COOKIE.admin));
  assert.ok(adminTools.some((tool) => tool.name === 'oa_orders_create_order'));
  console.log('PASS manifest GET 与适配器按权限过滤 create_order');

  // 4) list_references 只返回在职 designer/planner 的最小字段。
  const references = (await adapter.execute('oa_orders_list_references', { resource: 'employees', limit: 100 }, context(COOKIE.admin))).data;
  assert.equal(references.total, 2, JSON.stringify(references));
  for (const item of references.items) assert.deepEqual(Object.keys(item).sort(), ['catsco_uid', 'department', 'display_name', 'role']);
  assert.deepEqual(references.items.map((item) => item.catsco_uid).sort(), [DESIGNER.uid, PLANNER.uid]);
  assert.ok(references.items.every((item) => ['designer', 'planner'].includes(item.role)));
  console.log('PASS list_references 只返回在职 designer/planner 最小字段');

  // 5) create_order 默认只预览：无订单、无审计；正式提交必须提供幂等键。
  let beforeOrders = orderCount();
  let beforeAudit = auditCount();
  const preview = expectOk(await api(origin, COOKIE.executor, '/api/ai/orders', {
    method: 'POST', json: { tool: 'create_order', arguments: { order: orderPayload() } }
  }));
  assert.equal(preview.dry_run, true);
  assert.equal(preview.order.id, undefined);
  assert.equal(preview.order.products[0].unit_price, '12.50');
  assert.equal(preview.order.quote_amount, '25.00');
  assert.equal(preview.order.cost_amount, '5.00');
  assert.equal(orderCount(), beforeOrders);
  assert.equal(auditCount(), beforeAudit);

  expectError(await api(origin, COOKIE.executor, '/api/ai/orders', {
    method: 'POST', json: { tool: 'create_order', arguments: { order: orderPayload(), dry_run: false } }
  }), 400, 'VALIDATION_ERROR', 'arguments.idempotency_key');
  assert.equal(orderCount(), beforeOrders);
  assert.equal(auditCount(), beforeAudit);
  console.log('PASS create_order 默认预览不落库；正式提交缺少幂等键被拒绝');

  // 6) 正式创建：creator UID 由会话决定，金额为元字符串快照，审计记录真实 UID。
  const created = expectOk(await api(origin, COOKIE.executor, '/api/ai/orders', {
    method: 'POST', json: { tool: 'create_order', arguments: { order: orderPayload(), idempotency_key: 'AI-ORDER-K1', dry_run: false } }
  }));
  assert.equal(created.dry_run, false);
  assert.equal(created.replayed, false);
  const order1 = created.order;
  const orderId = order1.id;
  assert.ok(orderId);
  assert.equal(order1.created_by_uid, EXECUTOR.uid);
  assert.equal(order1.created_by, 'AI执行');
  assert.equal(order1.status, '已提交');
  assert.equal(order1.payment_status, '未结款');
  assert.equal(order1.designer_uid, DESIGNER.uid);
  assert.equal(order1.quote_amount, '25.00');
  assert.equal(order1.cost_amount, '5.00');
  assert.equal(order1.products[0].unit_price, '12.50', '单价应使用显式快照而非资料库价格');
  assert.equal(order1.products[0].remark, '行备注');
  assert.equal(auditCount(), beforeAudit + 1);
  const audit1 = withDb((db) => db.prepare("SELECT actor_uid,detail_json FROM audit_logs WHERE entity_type='order' ORDER BY created_at DESC LIMIT 1").get());
  assert.equal(audit1.actor_uid, EXECUTOR.uid);
  assert.equal(JSON.parse(audit1.detail_json).channel, 'ai_tool');
  console.log('PASS create_order 真实写入订单，created_by_uid=1001 且金额/快照正确');

  // 7) 幂等：同用户同键同内容返回同一订单且不新增审计；不同内容 409；不同用户同键独立。
  const afterCreateOrders = orderCount();
  const afterCreateAudit = auditCount();
  const replay = expectOk(await api(origin, COOKIE.executor, '/api/ai/orders', {
    method: 'POST', json: { tool: 'create_order', arguments: { order: orderPayload(), idempotency_key: 'AI-ORDER-K1', dry_run: false } }
  }));
  assert.equal(replay.replayed, true);
  assert.equal(replay.order.id, orderId);
  assert.equal(orderCount(), afterCreateOrders);
  assert.equal(auditCount(), afterCreateAudit);

  expectError(await api(origin, COOKIE.executor, '/api/ai/orders', {
    method: 'POST', json: { tool: 'create_order', arguments: { order: orderPayload({ note: '不同内容' }), idempotency_key: 'AI-ORDER-K1', dry_run: false } }
  }), 409, 'IDEMPOTENCY_CONFLICT');
  assert.equal(orderCount(), afterCreateOrders);
  assert.equal(auditCount(), afterCreateAudit);

  const adminCreated = expectOk(await api(origin, COOKIE.admin, '/api/ai/orders', {
    method: 'POST', json: { tool: 'create_order', arguments: { order: orderPayload(), idempotency_key: 'AI-ORDER-K1', dry_run: false } }
  }));
  assert.notEqual(adminCreated.order.id, orderId, '不同用户同键必须各自独立');
  assert.equal(adminCreated.order.created_by_uid, ADMIN.uid);
  assert.equal(orderCount(), afterCreateOrders + 1);
  assert.equal(auditCount(), afterCreateAudit + 1);
  console.log('PASS 幂等重试返回同 ID 不写审计；不同内容 409；不同用户同键独立');

  // 8) 可见性：不可见统一 404；finance 全看但不能编辑/创建；designer 参与可编辑但不能创建。
  const call = (cookie, tool, args) => api(origin, cookie, '/api/ai/orders', { method: 'POST', json: { tool, arguments: args } });
  const getOrder = (cookie, id = orderId) => call(cookie, 'get_order', { order_id: id });
  const executorView = expectOk(await getOrder(COOKIE.executor));
  assert.equal(executorView.can_edit, true);
  const designerView = expectOk(await getOrder(COOKIE.designer));
  assert.equal(designerView.can_edit, true);
  const financeView = expectOk(await getOrder(COOKIE.finance));
  assert.equal(financeView.can_edit, false);
  expectError(await getOrder(COOKIE.unrelated), 404, 'ORDER_NOT_FOUND');

  const search = (cookie) => call(cookie, 'search_orders', { project_id: PROJECT_ID, limit: 100 });
  assert.equal(expectOk(await search(COOKIE.unrelated)).total, 0);
  const financeSearch = expectOk(await search(COOKIE.finance));
  assert.equal(financeSearch.total, 2, 'finance 应能查看全部订单');
  assert.ok(expectOk(await search(COOKIE.designer)).items.some((item) => item.id === orderId));

  // 适配器 oa_orders_* 走同一真实链路。
  assert.equal((await adapter.execute('oa_orders_get_order', { order_id: orderId }, context(COOKIE.executor))).data.id, orderId);

  beforeAudit = auditCount();
  expectError(await call(COOKIE.finance, 'update_order', {
    order_id: orderId, expected_revision: financeView.revision, changes: { note: '财务修改' }, dry_run: false
  }), 403, 'FORBIDDEN');
  expectError(await call(COOKIE.finance, 'create_order', {
    order: orderPayload(), idempotency_key: 'AI-FINANCE', dry_run: false
  }), 403, 'FORBIDDEN');
  expectError(await call(COOKIE.designer, 'create_order', {
    order: orderPayload(), idempotency_key: 'AI-DESIGNER', dry_run: false
  }), 403, 'FORBIDDEN');
  expectError(await call(COOKIE.unrelated, 'update_order', {
    order_id: orderId, expected_revision: executorView.revision, changes: { note: '无关修改' }, dry_run: false
  }), 404, 'ORDER_NOT_FOUND');
  assert.equal(auditCount(), beforeAudit, '被拒绝的写入不得产生审计');
  assert.equal(orderCount(), afterCreateOrders + 1, '被拒绝的创建不得落库');
  console.log('PASS 不可见 404；finance 全看不可编辑/创建；designer 参与可编辑不可创建');

  // 9) update_order 局部更新：未传字段保持原值，显式 null 清除指派，costs:[] 清空，products:[] 拒绝。
  const changed = expectOk(await call(COOKIE.designer, 'update_order', {
    order_id: orderId, expected_revision: executorView.revision,
    changes: { note: '设计更新备注' }, dry_run: false
  }));
  assert.equal(changed.order.note, '设计更新备注');
  assert.equal(changed.order.contact, '联系人甲');
  assert.equal(changed.order.customer_department, '市场部');
  assert.equal(changed.order.execution_company, '执行公司一');
  assert.equal(changed.order.order_date, '2024-05-01');
  assert.equal(changed.order.delivery_date, '2024-06-01');
  assert.equal(changed.order.designer_uid, DESIGNER.uid, '未传指派不应改变');
  assert.equal(changed.order.planner_uid, null);
  assert.equal(changed.order.products.length, 1, '未传 products 应保留明细');
  assert.equal(changed.order.products[0].remark, '行备注');
  assert.equal(changed.order.costs.length, 1);
  assert.equal(changed.order.created_by, 'AI执行', '创建人姓名快照不得被覆盖');
  assert.equal(changed.order.created_by_uid, EXECUTOR.uid);
  assert.notEqual(changed.order.revision, executorView.revision);

  const cleared = expectOk(await call(COOKIE.designer, 'update_order', {
    order_id: orderId, expected_revision: changed.order.revision,
    changes: { designer_uid: null, costs: [] }, dry_run: false
  }));
  assert.equal(cleared.order.designer_uid, null);
  assert.equal(cleared.order.designer, '');
  assert.deepEqual(cleared.order.costs, []);
  assert.equal(cleared.order.cost_amount, '0.00');
  assert.equal(cleared.order.products.length, 1, '清空 costs 不影响 products');

  beforeAudit = auditCount();
  expectError(await call(COOKIE.executor, 'update_order', {
    order_id: orderId, expected_revision: cleared.order.revision, changes: { products: [] }, dry_run: false
  }), 400, 'VALIDATION_ERROR', 'arguments.changes.products');
  assert.equal(auditCount(), beforeAudit);
  const afterUpdateView = expectOk(await getOrder(COOKIE.executor));
  assert.equal(afterUpdateView.products.length, 1, '非法产品清空不得生效');
  assert.equal(afterUpdateView.revision, cleared.order.revision, '被拒绝的更新不得改变 revision');
  console.log('PASS update 局部字段不清空；null 清指派；costs:[] 清空；products:[] 拒绝且不落库');

  // 10) revision 并发冲突：包括直接网页式 SQL 修改 note。
  let currentView = expectOk(await getOrder(COOKIE.executor));
  const staleRevision = currentView.revision;
  expectOk(await call(COOKIE.executor, 'update_order', {
    order_id: orderId, expected_revision: staleRevision, changes: { note: '并发前修改' }, dry_run: false
  }));
  expectError(await call(COOKIE.executor, 'update_order', {
    order_id: orderId, expected_revision: staleRevision, changes: { note: '过期修改' }, dry_run: false
  }), 409, 'REVISION_CONFLICT');
  currentView = expectOk(await getOrder(COOKIE.executor));
  assert.equal(currentView.note, '并发前修改', '过期写入不得覆盖');

  withDb((db) => db.prepare('UPDATE orders_simple SET note=? WHERE id=?').run('网页直接修改', orderId));
  beforeAudit = auditCount();
  expectError(await call(COOKIE.executor, 'update_order', {
    order_id: orderId, expected_revision: currentView.revision, changes: { note: '旧快照再改' }, dry_run: false
  }), 409, 'REVISION_CONFLICT');
  assert.equal(auditCount(), beforeAudit);
  assert.equal(expectOk(await getOrder(COOKIE.executor)).note, '网页直接修改');
  console.log('PASS revision 并发冲突（含网页式 SQL note 修改）返回 409 且不覆盖');

  // 11) 非法输入统一拒绝且不写订单/审计。
  const invalidCases = [
    ['订单非法日期', { order: orderPayload({ order_date: '2024-02-31' }) }, 'arguments.order.order_date'],
    ['交付非法日期', { order: orderPayload({ delivery_date: '2024-13-01' }) }, 'arguments.order.delivery_date'],
    ['金额非字符串', { order: orderPayload({ products: [lineProduct({ unit_price: 12.5 })] }) }, 'arguments.order.products[0].unit_price'],
    ['金额负号', { order: orderPayload({ products: [lineProduct({ unit_price: '-1' })] }) }, 'arguments.order.products[0].unit_price'],
    ['数量为 0', { order: orderPayload({ products: [lineProduct({ quantity: 0 })] }) }, 'arguments.order.products[0].quantity'],
    ['数量为 null', { order: orderPayload({ products: [lineProduct({ quantity: null })] }) }, 'arguments.order.products[0].quantity'],
    ['指派 UID 非法', { order: orderPayload({ designer_uid: 'abc' }) }, 'arguments.order.designer_uid'],
    ['指派 UID 角色不符', { order: orderPayload({ planner_uid: DESIGNER.uid }) }, 'arguments.order.planner_uid'],
    ['指派 UID 停用', { order: orderPayload({ designer_uid: INACTIVE_DESIGNER.uid }) }, 'arguments.order.designer_uid'],
    ['报价外键不存在', { order: orderPayload({ products: [lineProduct({ catalog_id: 'missing-quote' })] }) }, 'arguments.order.products[0].catalog_id'],
    ['成本外键跨库', { order: orderPayload({ costs: [lineCost({ catalog_id: QUOTE_ITEM_ID })] }) }, 'arguments.order.costs[0].catalog_id'],
    ['夹带 created_by', { order: orderPayload({ created_by: '伪造创建人' }) }, 'arguments.order.created_by'],
    ['夹带 status', { order: orderPayload({ status: '已完成' }) }, 'arguments.order.status'],
    ['夹带 payment_status', { order: orderPayload({ payment_status: '已结款' }) }, 'arguments.order.payment_status'],
    ['订单缺项目', { order: { products: [lineProduct()] } }, 'arguments.order.project_id'],
    ['项目不存在', { order: orderPayload({ project_id: 'missing-project' }) }, 'arguments.order.project_id']
  ];
  const invalidOrders = orderCount();
  const invalidAudit = auditCount();
  for (const [label, args, path] of invalidCases) {
    expectError(await call(COOKIE.executor, 'create_order', { ...args, idempotency_key: `AI-BAD-${label}`, dry_run: false }), 400, 'VALIDATION_ERROR', path);
  }
  assert.equal(orderCount(), invalidOrders, `${invalidCases.length} 个非法创建均不得写订单`);
  assert.equal(auditCount(), invalidAudit, '非法创建不得写审计');

  // 更新侧同样拒绝非法字段且不写审计。
  let lockedView = expectOk(await getOrder(COOKIE.executor));
  for (const [label, changes, path] of [
    ['更新夹带 created_by', { created_by: '伪造' }, 'arguments.changes.created_by'],
    ['更新夹带 status', { status: '已完成' }, 'arguments.changes.status'],
    ['更新夹带 payment_status', { payment_status: '已结款' }, 'arguments.changes.payment_status'],
    ['更新非法日期', { order_date: '2024-02-31' }, 'arguments.changes.order_date'],
    ['更新非法金额', { products: [lineProduct({ unit_price: '1.234' })] }, 'arguments.changes.products[0].unit_price'],
    ['更新空 changes', {}, 'arguments.changes']
  ]) {
    expectError(await call(COOKIE.executor, 'update_order', {
      order_id: orderId, expected_revision: lockedView.revision, changes, dry_run: false
    }), 400, 'VALIDATION_ERROR', path);
  }
  assert.equal(auditCount(), invalidAudit, '非法更新不得写审计');
  lockedView = expectOk(await getOrder(COOKIE.executor));
  assert.equal(lockedView.revision, expectOk(await getOrder(COOKIE.executor)).revision);
  assert.equal(lockedView.note, '网页直接修改');
  console.log('PASS 非法日期/金额/null/数量/角色 UID/外键/受保护字段全部拒绝且不落库');

  // mock 网关只应由 OA 服务以虚构会话访问，没有真实凭据。
  assert.ok(gatewayRequests.length > 0);
  for (const gatewayRequest of gatewayRequests) {
    assert.equal(gatewayRequest.pathname, '/_gateway/me');
    assert.equal(gatewayRequest.app, APP_ID);
    assert.match(gatewayRequest.cookie, /^(|user=[A-E])$/, `网关只应收到虚构 Cookie，实际：${gatewayRequest.cookie}`);
  }

  // 12) 路由层契约：请求字段、工具名与错误结构。
  expectError(await api(origin, COOKIE.executor, '/api/ai/orders', {
    method: 'POST', json: { tool: 'create_order', arguments: {}, uid: ADMIN.uid }
  }), 400, 'VALIDATION_ERROR', 'uid');
  expectError(await api(origin, COOKIE.executor, '/api/ai/orders', {
    method: 'POST', json: { tool: 'delete_order', arguments: {} }
  }), 400, 'UNKNOWN_TOOL');
  expectError(await api(origin, COOKIE.executor, '/api/ai/orders', {
    method: 'POST', json: { tool: 'get_order', arguments: { order_id: orderId, uid: ADMIN.uid } }
  }), 400, 'VALIDATION_ERROR', 'arguments.uid');
  const anonymous = await api(origin, 'user=Z', '/api/ai/orders');
  assert.ok([401, 403].includes(anonymous.status), `未登录应被拒绝，实际 ${anonymous.status}: ${JSON.stringify(anonymous.data)}`);
  console.log('PASS 路由拒绝多余请求字段/未知工具/伪造 uid，未登录被拒');
} catch (error) {
  console.error('集成测试失败：', error);
  if (appLogs) console.error('--- OA 服务日志 ---\n' + appLogs);
  process.exitCode = 1;
} finally {
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

if (process.exitCode !== 1) console.log('ALL PASS ai-orders-test');
