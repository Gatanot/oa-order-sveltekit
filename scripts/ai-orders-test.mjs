/**
 * 集成测试：共享服务 Agent 模式的订单工具（/api/ai/orders）。
 *
 * 临时数据库 + 随机端口 + 只接受虚构 Cookie 的 mock Artifact 网关，真实启动 build 产物
 * （NODE_ENV=production，关闭 OA_TEST_AUTH_BYPASS）。AI 只带 X-OA-Agent-Key，创建人必须是
 * 员工档案 UID；订单归属员工而非执行 Agent。覆盖预览、幂等、批量原子事务、归属重排、
 * 审计、校验与“员工网页仍只看自己/参与订单”。finally 关闭服务/网关并删除临时目录。
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

import { createCatscoOaTools, OaToolHostError } from '../src/lib/server/catsco-oa-tools.js';

const ADMIN = { uid: 826, username: 'catsco' };
const CREATOR = { uid: 1101, username: 'ai-creator', name: 'AI创建者', role: 'executor' };
const DESIGNER = { uid: 1102, username: 'ai-designer', name: 'AI设计者', role: 'designer' };
const PLANNER = { uid: 1103, username: 'ai-planner', name: 'AI策划', role: 'planner' };
const FINANCE = { uid: 1104, username: 'ai-finance', name: 'AI财务', role: 'finance' };
const MANAGER = { uid: 1105, username: 'ai-manager', name: 'AI管理', role: 'manager' };
const OWNER = { uid: 1106, username: 'ai-owner', name: 'AI老板', role: 'owner' };
const INACTIVE = { uid: 1107, username: 'ai-inactive', name: 'AI停用', role: 'executor', active: 0 };
const PENDING = { uid: 1108, username: 'ai-pending', name: 'AI待开通', role: 'pending', active: 0 };
const UNRELATED = { uid: 1109, username: 'ai-unrelated', name: 'AI无关', role: 'executor' };
const ACTIVE_STAFF = [CREATOR, DESIGNER, PLANNER, FINANCE, MANAGER, OWNER, UNRELATED];
const COOKIE = { admin: 'user=A', creator: 'user=B', designer: 'user=C', unrelated: 'user=D' };
const VIEWER = new Map([['A', ADMIN], ['B', CREATOR], ['C', DESIGNER], ['D', UNRELATED]]);

const TEST_KEY = 'oa-ai-orders-test-key-' + '0123456789abcdef'.repeat(2);
const APP_ID = 'oa-ai-orders';
const AGENT_ID = 'shared-test';
const CUSTOMER_ID = 'cust-ai-orders';
const PROJECT_ID = 'proj-ai-orders';
const QUOTE_ITEM_ID = 'quote-ai-orders';
const COST_ITEM_ID = 'cost-ai-orders';
const directory = mkdtempSync(join(tmpdir(), 'oa-ai-orders-'));
const databasePath = join(directory, 'oa.db');

let mock;
let app;
let adapter;
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

/** 本地假网关：只认虚构 Cookie user=A..D，其余一律未登录。 */
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

async function startApp(gatewayOrigin) {
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    OA_TEST_AUTH_BYPASS: '',
    OA_AI_SERVICE_KEY: TEST_KEY,
    OA_AI_SERVICE_ID: AGENT_ID,
    OA_AI_SERVICE_NAME: '共享测试 Agent',
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
const lastOrderAudit = () => withDb((db) => db.prepare(`SELECT actor_uid,actor_name,action,entity_id,detail_json
  FROM audit_logs WHERE entity_type='order' ORDER BY rowid DESC LIMIT 1`).get());

async function call(tool, args) {
  return adapter.execute(`oa_orders_${tool}`, args);
}
async function ok(tool, args) {
  const result = await call(tool, args);
  assert.ok(result.data, `期望成功，实际：${JSON.stringify(result)}`);
  return result.data;
}
function expectError(result, code, path) {
  assert.ok(result.error, `期望错误 ${code}，实际：${JSON.stringify(result)}`);
  assert.equal(result.error.code, code, JSON.stringify(result));
  if (path !== undefined) assert.equal(result.error.path, path, JSON.stringify(result));
}
async function rejectsWith(promise, code, status) {
  await assert.rejects(promise, (reason) => {
    assert.ok(reason instanceof OaToolHostError, `应抛出 OaToolHostError，实际：${reason}`);
    assert.equal(reason.code, code);
    if (status !== undefined) assert.equal(reason.status, status);
    return true;
  });
}

function waitForExit(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

/** 测试数据全部写入临时数据库：客户、项目、多角色员工与报价/成本条目。 */
function seedDatabase() {
  withDb((db) => {
    const timestamp = new Date().toISOString();
    db.prepare('INSERT INTO customers_simple(id,name,contact,created_at) VALUES(?,?,?,?)')
      .run(CUSTOMER_ID, 'AI 订单客户', '客户联系人', timestamp);
    db.prepare('INSERT INTO projects_simple(id,customer_id,name,owner,status,created_at) VALUES(?,?,?,?,?,?)')
      .run(PROJECT_ID, CUSTOMER_ID, 'AI 订单项目', '项目负责人', '进行中', timestamp);
    const insertEmployee = db.prepare(`INSERT INTO employees(catsco_uid,username,display_name,department,role,active,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`);
    for (const employee of [...ACTIVE_STAFF, INACTIVE, PENDING]) {
      insertEmployee.run(employee.uid, employee.username, employee.name, '', employee.role, employee.active ?? 1, timestamp, timestamp);
    }
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
  project_id: PROJECT_ID, created_by_uid: CREATOR.uid, order_date: '2024-05-01', delivery_date: '2024-06-01',
  contact: '联系人甲', customer_department: '市场部', execution_company: '执行公司一',
  note: '初始备注', designer_uid: DESIGNER.uid, products: [lineProduct()], costs: [lineCost()],
  ...overrides
});
const createArgs = (overrides = {}, key, dryRun) => ({
  order: orderPayload(overrides),
  ...(key === undefined ? {} : { idempotency_key: key }),
  ...(dryRun === undefined ? {} : { dry_run: dryRun })
});

try {
  const gatewayOrigin = await startMockGateway();
  app = await startApp(gatewayOrigin);
  const origin = app.origin;

  // 1) 用网页 admin Cookie 初始化数据库，再写入测试数据；之后所有 AI 请求都不应访问网关。
  let response = await request(origin, '/api/orders', { headers: { cookie: COOKIE.admin } });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  seedDatabase();
  adapter = createCatscoOaTools({ appBaseUrl: `${origin}/`, apiKey: TEST_KEY });
  const gatewayBeforeAi = gatewayRequests.length;

  const info = await adapter.execute('oa_agent_info', {});
  assert.equal(info.data.kind, 'service_agent');
  assert.equal(info.data.agent_id, AGENT_ID);
  const toolNames = (await adapter.listTools()).map((tool) => tool.name);
  for (const name of ['oa_orders_create_order', 'oa_orders_batch_create_orders', 'oa_orders_update_order', 'oa_orders_list_references']) {
    assert.ok(toolNames.includes(name), `缺少工具 ${name}: ${toolNames}`);
  }
  console.log('PASS 服务 Agent 身份 shared-test，订单工具清单可用');

  // 2) 员工参考数据：所有 active 且非 pending 的多角色员工，可按 role 过滤。
  const references = await ok('list_references', { resource: 'employees', limit: 100 });
  assert.equal(references.total, ACTIVE_STAFF.length, JSON.stringify(references));
  assert.deepEqual(references.items.map((item) => item.role).sort(),
    ACTIVE_STAFF.map((employee) => employee.role).sort());
  assert.ok(references.items.every((item) => !['pending'].includes(item.role)));
  assert.ok(!references.items.some((item) => item.catsco_uid === INACTIVE.uid || item.catsco_uid === PENDING.uid));
  for (const item of references.items) assert.deepEqual(Object.keys(item).sort(), ['catsco_uid', 'department', 'display_name', 'role']);
  const designers = await ok('list_references', { resource: 'employees', role: 'designer', limit: 100 });
  assert.deepEqual(designers.items.map((item) => item.catsco_uid), [DESIGNER.uid]);
  const executors = await ok('list_references', { resource: 'employees', role: 'executor', limit: 100 });
  assert.deepEqual(executors.items.map((item) => item.catsco_uid).sort(), [CREATOR.uid, UNRELATED.uid].sort());
  expectError(await call('list_references', { resource: 'employees', role: 'pending' }), 'VALIDATION_ERROR', 'arguments.role');
  console.log('PASS list_references 返回全部在职非 pending 员工，role 过滤正确');

  // 3) 创建预览必须显式 created_by_uid，且归属员工而非服务 Agent。
  let beforeOrders = orderCount();
  let beforeAudit = auditCount();
  const missingCreator = orderPayload();
  delete missingCreator.created_by_uid;
  expectError(await call('create_order', { order: missingCreator }), 'VALIDATION_ERROR', 'arguments.order.created_by_uid');
  expectError(await call('create_order', createArgs({ created_by_uid: null })), 'VALIDATION_ERROR', 'arguments.order.created_by_uid');
  expectError(await call('create_order', createArgs({ created_by_uid: 9999 })), 'VALIDATION_ERROR', 'arguments.order.created_by_uid');
  expectError(await call('create_order', createArgs({ created_by_uid: INACTIVE.uid })), 'VALIDATION_ERROR', 'arguments.order.created_by_uid');
  expectError(await call('create_order', createArgs({ created_by: '伪造创建人' })), 'VALIDATION_ERROR', 'arguments.order.created_by');
  const preview = await ok('create_order', createArgs());
  assert.equal(preview.dry_run, true);
  assert.equal(preview.replayed, false);
  assert.equal(preview.order.id, undefined);
  assert.equal(preview.order.created_by_uid, CREATOR.uid);
  assert.equal(preview.order.created_by, CREATOR.name);
  assert.notEqual(preview.order.created_by_uid, -1, '创建人不能是服务执行者');
  assert.equal(preview.order.quote_amount, '25.00');
  assert.equal(preview.order.cost_amount, '5.00');
  assert.equal(orderCount(), beforeOrders);
  assert.equal(auditCount(), beforeAudit);
  console.log('PASS 创建预览强制 created_by_uid，归属员工且不落库');

  // 4) 正式创建：订单归属员工，审计 actor_uid=null、detail.agent_id=shared-test。
  beforeOrders = orderCount();
  beforeAudit = auditCount();
  const created = await ok('create_order', createArgs({}, 'AI-ORDER-K1', false));
  assert.equal(created.dry_run, false);
  assert.equal(created.replayed, false);
  const orderId = created.order.id;
  assert.ok(orderId);
  assert.equal(created.order.created_by_uid, CREATOR.uid);
  assert.equal(created.order.created_by, CREATOR.name);
  assert.equal(created.order.status, '已提交');
  assert.equal(created.order.payment_status, '未结款');
  assert.equal(created.order.designer_uid, DESIGNER.uid);
  assert.equal(created.order.quote_amount, '25.00');
  assert.equal(created.order.products[0].unit_price, '12.50');
  assert.equal(orderCount(), beforeOrders + 1);
  assert.equal(auditCount(), beforeAudit + 1);
  let audit = lastOrderAudit();
  assert.equal(audit.actor_uid, null);
  assert.equal(audit.action, 'create');
  assert.equal(audit.entity_id, orderId);
  let detail = JSON.parse(audit.detail_json);
  assert.equal(detail.channel, 'ai_service');
  assert.equal(detail.agent_id, AGENT_ID);
  assert.equal(detail.tool, 'create_order');
  assert.equal(detail.created_by_uid, CREATOR.uid);
  console.log('PASS 真实创建归属 AI创建者，审计 actor_uid=null 且带 agent_id');

  // 5) 同一 Agent 同 key 同内容重放，不新增订单/审计；不同内容 409。
  const afterCreateOrders = orderCount();
  const afterCreateAudit = auditCount();
  const replay = await ok('create_order', createArgs({}, 'AI-ORDER-K1', false));
  assert.equal(replay.replayed, true);
  assert.equal(replay.order.id, orderId);
  assert.equal(orderCount(), afterCreateOrders);
  assert.equal(auditCount(), afterCreateAudit);
  expectError(await call('create_order', createArgs({ note: '不同内容' }, 'AI-ORDER-K1', false)),
    'IDEMPOTENCY_CONFLICT', 'arguments.idempotency_key');
  assert.equal(orderCount(), afterCreateOrders);
  assert.equal(auditCount(), afterCreateAudit);
  console.log('PASS 幂等重放不写审计；同 key 不同内容返回 409');

  // 6) 服务 Agent 可查询全部订单，并局部更新 / 重新归属，保留未传字段。
  const allOrders = await ok('search_orders', { limit: 100 });
  assert.equal(allOrders.total, orderCount());
  assert.ok(allOrders.items.some((item) => item.id === orderId));
  let view = await ok('get_order', { order_id: orderId });
  let updated = await ok('update_order', {
    order_id: orderId, expected_revision: view.revision, changes: { note: '服务代理更新' }, dry_run: false
  });
  assert.equal(updated.order.note, '服务代理更新');
  assert.equal(updated.order.contact, '联系人甲');
  assert.equal(updated.order.customer_department, '市场部');
  assert.equal(updated.order.created_by_uid, CREATOR.uid, '未重新归属时仍属于原创建人');
  assert.equal(updated.order.products.length, 1);
  audit = lastOrderAudit();
  assert.equal(audit.actor_uid, null);
  detail = JSON.parse(audit.detail_json);
  assert.equal(detail.agent_id, AGENT_ID);
  assert.equal(detail.tool, 'update_order');

  const staleRevision = updated.order.revision;
  const reassigned = await ok('update_order', {
    order_id: orderId, expected_revision: staleRevision, changes: { created_by_uid: DESIGNER.uid }, dry_run: false
  });
  assert.equal(reassigned.order.created_by_uid, DESIGNER.uid);
  assert.equal(reassigned.order.created_by, DESIGNER.name);
  assert.equal(reassigned.order.note, '服务代理更新', '重新归属不得清空其他字段');
  assert.equal(reassigned.order.contact, '联系人甲');
  assert.equal(reassigned.order.products.length, 1);
  audit = lastOrderAudit();
  assert.equal(audit.actor_uid, null);
  assert.equal(JSON.parse(audit.detail_json).agent_id, AGENT_ID);
  expectError(await call('update_order', {
    order_id: orderId, expected_revision: staleRevision, changes: { note: '过期修改' }, dry_run: false
  }), 'REVISION_CONFLICT');
  assert.equal((await ok('get_order', { order_id: orderId })).note, '服务代理更新');
  console.log('PASS Agent 全量查询/编辑，重新归属保留字段，过期 revision 409');

  // 7) 更新侧校验：非法创建人、错误岗位、受保护字段、金额/日期/明细，均不写审计。
  const locked = await ok('get_order', { order_id: orderId });
  beforeAudit = auditCount();
  for (const [label, changes, path] of [
    ['创建人 null', { created_by_uid: null }, 'arguments.changes.created_by_uid'],
    ['创建人停用', { created_by_uid: INACTIVE.uid }, 'arguments.changes.created_by_uid'],
    ['创建人未知', { created_by_uid: 9999 }, 'arguments.changes.created_by_uid'],
    ['designer 岗位错误', { designer_uid: PLANNER.uid }, 'arguments.changes.designer_uid'],
    ['planner 岗位错误', { planner_uid: DESIGNER.uid }, 'arguments.changes.planner_uid'],
    ['非法日期', { order_date: '2024-02-31' }, 'arguments.changes.order_date'],
    ['非法金额', { products: [lineProduct({ unit_price: '1.234' })] }, 'arguments.changes.products[0].unit_price'],
    ['清空 products', { products: [] }, 'arguments.changes.products'],
    ['夹带 status', { status: '已完成' }, 'arguments.changes.status'],
    ['夹带 payment_status', { payment_status: '已结款' }, 'arguments.changes.payment_status'],
    ['夹带 created_by 文本', { created_by: '伪造' }, 'arguments.changes.created_by'],
    ['夹带 role', { role: 'admin' }, 'arguments.changes.role']
  ]) {
    expectError(await call('update_order', {
      order_id: orderId, expected_revision: locked.revision, changes, dry_run: false
    }), 'VALIDATION_ERROR', path);
  }
  assert.equal(auditCount(), beforeAudit, '非法更新不得写审计');
  console.log('PASS 更新非法创建人/岗位/受保护字段/金额日期全部拒绝且不写审计');

  // 8) 创建侧校验：创建人、岗位、金额日期、外键、受保护字段。
  beforeOrders = orderCount();
  beforeAudit = auditCount();
  const invalidCreates = [
    ['创建人 null', orderPayload({ created_by_uid: null }), 'arguments.order.created_by_uid'],
    ['创建人未知', orderPayload({ created_by_uid: 9999 }), 'arguments.order.created_by_uid'],
    ['创建人停用', orderPayload({ created_by_uid: INACTIVE.uid }), 'arguments.order.created_by_uid'],
    ['创建人 pending', orderPayload({ created_by_uid: PENDING.uid }), 'arguments.order.created_by_uid'],
    ['designer 岗位错误', orderPayload({ designer_uid: PLANNER.uid }), 'arguments.order.designer_uid'],
    ['planner 岗位错误', orderPayload({ planner_uid: DESIGNER.uid }), 'arguments.order.planner_uid'],
    ['非法金额', orderPayload({ products: [lineProduct({ unit_price: '1.234' })] }), 'arguments.order.products[0].unit_price'],
    ['负金额', orderPayload({ products: [lineProduct({ unit_price: '-1' })] }), 'arguments.order.products[0].unit_price'],
    ['非法日期', orderPayload({ order_date: '2024-02-31' }), 'arguments.order.order_date'],
    ['非法交付日期', orderPayload({ delivery_date: '2024-13-01' }), 'arguments.order.delivery_date'],
    ['项目外键', orderPayload({ project_id: 'missing-project' }), 'arguments.order.project_id'],
    ['报价外键', orderPayload({ products: [lineProduct({ catalog_id: 'missing-quote' })] }), 'arguments.order.products[0].catalog_id'],
    ['成本跨库外键', orderPayload({ costs: [lineCost({ catalog_id: QUOTE_ITEM_ID })] }), 'arguments.order.costs[0].catalog_id'],
    ['夹带 created_by', orderPayload({ created_by: '伪造' }), 'arguments.order.created_by'],
    ['夹带 status', orderPayload({ status: '已完成' }), 'arguments.order.status'],
    ['夹带 payment_status', orderPayload({ payment_status: '已结款' }), 'arguments.order.payment_status'],
    ['夹带 role', orderPayload({ role: 'admin' }), 'arguments.order.role']
  ];
  for (const [index, [, order, path]] of invalidCreates.entries()) {
    expectError(await call('create_order', { order, idempotency_key: `AI-BAD-${index}`, dry_run: false }),
      'VALIDATION_ERROR', path);
  }
  assert.equal(orderCount(), beforeOrders);
  assert.equal(auditCount(), beforeAudit);
  console.log('PASS 创建非法创建人/岗位/金额日期/外键/受保护字段全部拒绝且不落库');

  // 9) 批量预览不写；真实批量逐单归属多员工，审计逐单记录，重放安全。
  beforeOrders = orderCount();
  beforeAudit = auditCount();
  const batchPreviewEntries = [
    { order: orderPayload({ created_by_uid: CREATOR.uid, note: '批量预览A' }), idempotency_key: 'BATCH-PRE-1' },
    { order: orderPayload({ created_by_uid: FINANCE.uid, note: '批量预览B' }), idempotency_key: 'BATCH-PRE-2' }
  ];
  const batchPreview = await ok('batch_create_orders', { entries: batchPreviewEntries });
  assert.equal(batchPreview.dry_run, true);
  assert.equal(batchPreview.total, 2);
  assert.ok(batchPreview.items.every((item) => item.dry_run === true && item.replayed === false));
  assert.deepEqual(batchPreview.items.map((item) => item.order.created_by_uid), [CREATOR.uid, FINANCE.uid]);
  assert.equal(orderCount(), beforeOrders);
  assert.equal(auditCount(), beforeAudit);

  const batchEntries = [
    { order: orderPayload({ created_by_uid: CREATOR.uid, note: '批量写入A' }), idempotency_key: 'BATCH-REAL-1' },
    { order: orderPayload({ created_by_uid: FINANCE.uid, note: '批量写入B' }), idempotency_key: 'BATCH-REAL-2' }
  ];
  const batchCreated = await ok('batch_create_orders', { entries: batchEntries, dry_run: false });
  assert.equal(batchCreated.dry_run, false);
  assert.equal(batchCreated.total, 2);
  assert.ok(batchCreated.items.every((item) => item.replayed === false));
  assert.deepEqual(batchCreated.items.map((item) => item.order.created_by_uid), [CREATOR.uid, FINANCE.uid]);
  assert.deepEqual(batchCreated.items.map((item) => item.order.created_by), [CREATOR.name, FINANCE.name]);
  assert.equal(orderCount(), beforeOrders + 2);
  assert.equal(auditCount(), beforeAudit + 2);
  const batchIds = batchCreated.items.map((item) => item.order.id);
  const batchAudits = withDb((db) => db.prepare(`SELECT actor_uid,detail_json FROM audit_logs
    WHERE entity_type='order' AND entity_id IN (?,?)`).all(...batchIds));
  assert.equal(batchAudits.length, 2);
  for (const row of batchAudits) {
    assert.equal(row.actor_uid, null);
    const batchDetail = JSON.parse(row.detail_json);
    assert.equal(batchDetail.agent_id, AGENT_ID);
    assert.equal(batchDetail.tool, 'batch_create_orders');
  }
  const batchReplay = await ok('batch_create_orders', { entries: batchEntries, dry_run: false });
  assert.ok(batchReplay.items.every((item) => item.replayed === true));
  assert.deepEqual(batchReplay.items.map((item) => item.order.id), batchIds);
  assert.equal(orderCount(), beforeOrders + 2);
  assert.equal(auditCount(), beforeAudit + 2);
  console.log('PASS batch 预览不写；真实批量多员工逐单归属；重放不新增订单/审计');

  // 10) 批量重复 key、坏行、1–50 上限。
  beforeOrders = orderCount();
  beforeAudit = auditCount();
  expectError(await call('batch_create_orders', {
    entries: [
      { order: orderPayload({ note: '重复键1' }), idempotency_key: 'BATCH-DUP' },
      { order: orderPayload({ note: '重复键2' }), idempotency_key: 'BATCH-DUP' }
    ], dry_run: false
  }), 'VALIDATION_ERROR', 'arguments.entries[1].idempotency_key');
  expectError(await call('batch_create_orders', {
    entries: [
      { order: orderPayload({ note: '坏行前正常' }), idempotency_key: 'BATCH-BAD-1' },
      { order: orderPayload({ project_id: 'missing-project' }), idempotency_key: 'BATCH-BAD-2' }
    ], dry_run: false
  }), 'VALIDATION_ERROR', 'arguments.entries[1].order.project_id');
  assert.equal(orderCount(), beforeOrders, '坏行批量不得留下任何订单');
  assert.equal(auditCount(), beforeAudit, '坏行批量不得留下任何审计');
  const maxEntries = Array.from({ length: 50 }, (_, index) => ({
    order: orderPayload({ created_by_uid: index % 2 ? CREATOR.uid : DESIGNER.uid, note: `批量上限${index}` }),
    idempotency_key: `BATCH-MAX-${index}`
  }));
  const maxPreview = await ok('batch_create_orders', { entries: maxEntries });
  assert.equal(maxPreview.total, 50);
  assert.equal(orderCount(), beforeOrders);
  expectError(await call('batch_create_orders', {
    entries: [...maxEntries, { order: orderPayload(), idempotency_key: 'BATCH-MAX-50' }]
  }), 'VALIDATION_ERROR', 'arguments.entries');
  expectError(await call('batch_create_orders', { entries: [] }), 'VALIDATION_ERROR', 'arguments.entries');
  console.log('PASS batch 拒绝重复 key/坏行/空批量/超过 50 条，坏行全部回滚');

  // 11) 真实事务：中途数据库失败时已写入条目全部回滚，幂等键也未消费。
  beforeOrders = orderCount();
  beforeAudit = auditCount();
  withDb((db) => db.exec(`CREATE TRIGGER fail_atomic_batch BEFORE INSERT ON orders_simple
    WHEN NEW.note='ATOMIC-FAIL' BEGIN SELECT RAISE(ABORT,'forced atomic failure'); END;`));
  try {
    await rejectsWith(adapter.execute('oa_orders_batch_create_orders', {
      entries: [
        { order: orderPayload({ note: 'ATOMIC-OK' }), idempotency_key: 'BATCH-ATOMIC-1' },
        { order: orderPayload({ note: 'ATOMIC-FAIL' }), idempotency_key: 'BATCH-ATOMIC-2' }
      ], dry_run: false
    }), 'OA_UNAVAILABLE', 503);
  } finally {
    withDb((db) => db.exec('DROP TRIGGER IF EXISTS fail_atomic_batch'));
  }
  assert.equal(orderCount(), beforeOrders, '中途失败必须回滚已写入的订单');
  assert.equal(auditCount(), beforeAudit, '中途失败必须回滚审计');
  const atomicRetry = await ok('create_order', createArgs({ note: 'ATOMIC-OK' }, 'BATCH-ATOMIC-1', false));
  assert.ok(atomicRetry.order.id, '回滚后幂等键应可重新使用');
  assert.equal(orderCount(), beforeOrders + 1);
  console.log('PASS batch 真实事务中途失败全部回滚，幂等键未被消费');

  // 12) AI 请求全程没有访问 Artifact 网关。
  assert.equal(gatewayRequests.length, gatewayBeforeAi, 'AI 请求不应访问 Artifact gateway');

  // 13) 员工网页仍只能看到自己创建/参与的订单，且 finance 等全量视角不受 Agent 影响。
  const totalOrders = orderCount();
  for (const [cookie, employee] of [[COOKIE.creator, CREATOR], [COOKIE.designer, DESIGNER], [COOKIE.unrelated, UNRELATED]]) {
    response = await request(origin, '/api/orders', { headers: { cookie } });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const expectedIds = withDb((db) => db.prepare(`SELECT id FROM orders_simple
      WHERE created_by_uid=? OR designer_uid=? OR planner_uid=? ORDER BY id`).pluck().all(employee.uid, employee.uid, employee.uid));
    const actualIds = response.data.data.map((order) => order.id).sort();
    assert.deepEqual(actualIds, expectedIds, `${employee.name} 网页订单应只包含自己创建/参与的订单`);
    if (employee === CREATOR) assert.ok(expectedIds.length > 0 && expectedIds.length < totalOrders);
  }
  response = await request(origin, '/api/orders', { headers: { cookie: COOKIE.admin } });
  assert.equal(response.data.data.length, totalOrders, '网页 admin 仍可查看全部订单');
  console.log('PASS 员工网页仍只看自己/参与订单，admin 仍可看全部');

  for (const gatewayRequest of gatewayRequests) {
    assert.equal(gatewayRequest.pathname, '/_gateway/me');
    assert.equal(gatewayRequest.app, APP_ID);
    assert.match(gatewayRequest.cookie, /^(|user=[A-D])$/, `网关只应收到虚构 Cookie，实际：${gatewayRequest.cookie}`);
  }
  assert.ok(gatewayRequests.length > gatewayBeforeAi, '网页 Cookie 请求应已由网关校验');
} catch (error) {
  console.error('集成测试失败：', error);
  if (app?.logs) console.error('--- OA 服务日志 ---\n' + app.logs);
  process.exitCode = 1;
} finally {
  if (app?.child) {
    if (app.child.exitCode === null) app.child.kill('SIGTERM');
    await waitForExit(app.child);
  }
  if (mock) {
    await new Promise((resolve) => mock.close(resolve));
    mock.closeAllConnections?.();
  }
  rmSync(directory, { recursive: true, force: true });
}

if (process.exitCode !== 1) console.log('ALL PASS ai-orders-test');
