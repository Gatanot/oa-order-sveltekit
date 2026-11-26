import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import * as XLSX from 'xlsx';
import { strFromU8, unzipSync } from 'fflate';

const directory = mkdtempSync(join(tmpdir(), 'oa-order-test-'));
const databasePath = join(directory, 'oa.db');
const port = 4300 + Math.floor(Math.random() * 500);
const origin = `http://127.0.0.1:${port}`;
// 独立本机入口与网页服务共用同一测试数据库，但使用独立端口和独立进程。
const localPort = 6300 + Math.floor(Math.random() * 500);
const localOrigin = `http://127.0.0.1:${localPort}`;
const localEntryPath = join(process.cwd(), 'build-local', 'server.js');
const server = spawn(process.execPath, ['build'], { env: { ...process.env, DATABASE_PATH: databasePath, NODE_ENV: 'test', OA_TEST_AUTH_BYPASS: '1', PORT: String(port), ORIGIN: origin }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
server.stdout.on('data', (chunk) => { logs += chunk; });
server.stderr.on('data', (chunk) => { logs += chunk; });
let localServer = null;
let localLogs = '';
let fixturePortOffset = 0;

async function waitForServer(targetOrigin = origin, readLogs = () => logs, child = server, probePath = '/orders', readyStatuses = null) {
  let lastStatus = 'no response';
  for (let index = 0; index < 80; index++) {
    // 进程已退出时立即失败并带上日志，避免迁移/启动错误只表现为 8 秒超时。
    if (child.exitCode !== null) throw new Error(`服务器已退出（code ${child.exitCode}）\n${readLogs()}`);
    let response;
    try { response = await fetch(`${targetOrigin}${probePath}`); } catch { /* 端口未就绪，重试 */ }
    // 部分身份（待开通/未登录）本就无法拿到 2xx，按预期状态码判断是否已可响应。
    if (response) lastStatus = response.status;
    if (response && (readyStatuses ? readyStatuses.includes(response.status) : response.ok)) return;
    // 服务已能响应但返回非预期 5xx，说明迁移/初始化失败，立即失败而不是空等 8 秒。
    if (response && !readyStatuses && response.status >= 500) throw new Error(`服务器启动失败（HTTP ${response.status}）\n${readLogs()}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`服务器启动超时（最后状态：${lastStatus}）\n${readLogs()}`);
}

/** 原生 node:http 请求：本机入口会拒绝带浏览器 Fetch metadata 的请求，不能使用 fetch。 */
function rawHttp(base, path, { method = 'GET', headers = {}, body } = {}) {
  const url = new URL(path, base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode || 0,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
      res.on('error', reject);
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/**
 * request helper：/api/ai/* 一律分流到独立本机入口（raw HTTP，不自动带密钥）；
 * 其余网页/业务接口仍走网页服务的 fetch。
 */
async function request(path, { json, ...options } = {}) {
  if (path.startsWith('/api/ai/')) {
    const headers = { ...(options.headers || {}) };
    let body = options.body;
    if (json !== undefined) {
      headers['content-type'] = 'application/json';
      body = Buffer.from(JSON.stringify(json));
    }
    if (Buffer.isBuffer(body)) headers['content-length'] = String(body.byteLength);
    const raw = await rawHttp(localOrigin, path, { method: options.method || 'GET', headers, body });
    const text = raw.body.toString('utf8');
    const contentType = String(raw.headers['content-type'] || '');
    const response = {
      status: raw.status,
      headers: { get: (name) => raw.headers[String(name).toLowerCase()] ?? null }
    };
    const data = contentType.includes('json') && text ? JSON.parse(text) : raw.body;
    return { response, data };
  }
  const headers = new Headers(options.headers);
  if (json !== undefined) headers.set('content-type', 'application/json');
  if (options.body instanceof FormData) headers.set('origin', origin);
  const response = await fetch(`${origin}${path}`, { ...options, headers, body: json === undefined ? options.body : JSON.stringify(json), redirect: 'manual' });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('json') ? await response.json() : await response.arrayBuffer();
  return { response, data };
}

/** 以工具名调用本机代录 AI 小工具：统一 POST /api/ai/catalog 的 {tool,arguments} 请求体。 */
async function aiCall(tool, args) {
  return request('/api/ai/catalog', { method: 'POST', json: { tool, arguments: args } });
}

/** 复制当前数据库为旧版本 fixture，启动一次服务触发迁移，再用只读连接断言结果。 */
/** v27 迁移需要从旧 catalog_items 迁出数据；legacy fixture 复制自 v27 库，需按需重建旧目录表。 */
function restoreLegacyCatalog(legacy) {
  legacy.pragma('foreign_keys = OFF');
  legacy.exec(`
    DROP TABLE IF EXISTS catalog_quote_items;
    DROP TABLE IF EXISTS catalog_cost_items;
    CREATE TABLE catalog_quote_items(id TEXT PRIMARY KEY,source_id TEXT,active INTEGER NOT NULL DEFAULT 1,item_no TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT '',name TEXT NOT NULL,specification TEXT NOT NULL DEFAULT '',unit TEXT NOT NULL DEFAULT '项',estimated_quantity TEXT NOT NULL DEFAULT '',price_incl_tax INTEGER NOT NULL DEFAULT 0,price_excl_tax INTEGER NOT NULL DEFAULT 0,tax_rate TEXT NOT NULL DEFAULT '',max_price INTEGER NOT NULL DEFAULT 0,customer_name TEXT NOT NULL DEFAULT '',project_name TEXT NOT NULL DEFAULT '',remark TEXT NOT NULL DEFAULT '',source_file TEXT NOT NULL DEFAULT '',source_sheet TEXT NOT NULL DEFAULT '',source_type TEXT NOT NULL DEFAULT 'customer_quote',raw_data TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,UNIQUE(category,name,customer_name,project_name,specification,estimated_quantity));
    CREATE TABLE catalog_cost_items(id TEXT PRIMARY KEY,source_id TEXT,active INTEGER NOT NULL DEFAULT 1,item_no TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT '',name TEXT NOT NULL,specification TEXT NOT NULL DEFAULT '',unit TEXT NOT NULL DEFAULT '项',supplier_name TEXT NOT NULL DEFAULT '',cost_unit INTEGER NOT NULL DEFAULT 0,cost_unit_excl_tax INTEGER NOT NULL DEFAULT 0,tax_rate TEXT NOT NULL DEFAULT '',min_quantity TEXT NOT NULL DEFAULT '',remark TEXT NOT NULL DEFAULT '',source_file TEXT NOT NULL DEFAULT '',source_sheet TEXT NOT NULL DEFAULT '',source_type TEXT NOT NULL DEFAULT 'supplier_cost',raw_data TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,UNIQUE(category,name,supplier_name,specification));
    CREATE INDEX idx_catalog_quote_source ON catalog_quote_items(source_id,active);
    CREATE INDEX idx_catalog_cost_source ON catalog_cost_items(source_id,active);
    CREATE TABLE IF NOT EXISTS catalog_items(id TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '项', quote_unit INTEGER NOT NULL DEFAULT 0, cost_unit INTEGER NOT NULL DEFAULT 0, customer_name TEXT NOT NULL DEFAULT '', project_name TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, source_file TEXT NOT NULL DEFAULT '', source_sheet TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL DEFAULT 'manual', item_no TEXT NOT NULL DEFAULT '', specification TEXT NOT NULL DEFAULT '', estimated_quantity TEXT NOT NULL DEFAULT '', max_quote_unit INTEGER NOT NULL DEFAULT 0, supplier_remark TEXT NOT NULL DEFAULT '', raw_data TEXT NOT NULL DEFAULT '{}', source_id TEXT, UNIQUE(category,name,customer_name,project_name,specification,estimated_quantity));
  `);
  legacy.pragma('foreign_keys = ON');
}

async function withMigratedFixture(name, legacyVersion, prepare, assertions) {
  const path = join(directory, name);
  const source = new Database(databasePath, { readonly: true });
  await source.backup(path);
  source.close();
  const legacy = new Database(path);
  prepare(legacy);
  // fixture 复制自当前（v33）库；模拟 v29 之前的结构时，把已合并的订单来源拆回旧的两列。
  if (Number(legacyVersion) < 29) {
    legacy.exec("ALTER TABLE orders_simple DROP COLUMN order_source; ALTER TABLE orders_simple ADD COLUMN contact TEXT NOT NULL DEFAULT ''; ALTER TABLE orders_simple ADD COLUMN customer_department TEXT NOT NULL DEFAULT '';");
    legacy.prepare("UPDATE orders_simple SET contact='旧联系人', customer_department='旧部门'").run();
  }
  // v27/v29 重建订单时外键仍指向 customers_simple；从当前（v33）库回放旧版本时补回该表，
  // 保证旧版迁移的 foreign_key_check 能代表真实旧库，最终再由 v33 迁移到客户档案。
  if (Number(legacyVersion) < 33 && !legacy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='customers_simple'").get()) {
    legacy.exec("CREATE TABLE customers_simple(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, contact TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)");
    legacy.exec("INSERT INTO customers_simple(id,name,contact,created_at) SELECT id,name,contact,created_at FROM customer_profiles");
  }
  legacy.prepare("UPDATE schema_meta SET value = ? WHERE key = 'order_app_version'").run(legacyVersion);
  legacy.close();
  const fixturePort = port + 501 + fixturePortOffset++;
  const fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
  let fixtureLogs = '';
  const fixtureServer = spawn(process.execPath, ['build'], { env: { ...process.env, DATABASE_PATH: path, NODE_ENV: 'test', OA_TEST_AUTH_BYPASS: '1', PORT: String(fixturePort), ORIGIN: fixtureOrigin }, stdio: ['ignore', 'pipe', 'pipe'] });
  fixtureServer.stdout.on('data', (chunk) => { fixtureLogs += chunk; });
  fixtureServer.stderr.on('data', (chunk) => { fixtureLogs += chunk; });
  try {
    await waitForServer(fixtureOrigin, () => fixtureLogs, fixtureServer);
    const migrated = new Database(path, { readonly: true });
    try {
      assertions(migrated);
    } finally {
      migrated.close();
    }
  } finally {
    fixtureServer.kill('SIGTERM');
  }
}

/** 只读连接做数据库断言，避免影响被测服务持有的写连接。 */
function readDb(assertions) {
  const connection = new Database(databasePath, { readonly: true });
  try {
    return assertions(connection);
  } finally {
    connection.close();
  }
}

async function requestOn(base, path, { json, ...options } = {}) {
  const headers = new Headers(options.headers);
  // 刻意不注入任何 AI 密钥或身份：网页 /api/ai/* 已下线，统一应返回 410 LOCAL_ENTRY_ONLY。
  if (json !== undefined) headers.set('content-type', 'application/json');
  if (options.body instanceof FormData) headers.set('origin', base);
  const response = await fetch(`${base}${path}`, { ...options, headers, body: json === undefined ? options.body : JSON.stringify(json), redirect: 'manual' });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('json') ? await response.json() : await response.arrayBuffer();
  return { response, data };
}

/** 网页 AI 路由已下线：无论网页身份如何，都必须返回 410 LOCAL_ENTRY_ONLY。 */
function assertWebAiOffline(result, message) {
  assert.equal(result.response.status, 410, message);
  let body = result.data;
  if (!body || typeof body !== 'object' || body instanceof ArrayBuffer) {
    const text = typeof body === 'string' ? body : body instanceof ArrayBuffer ? Buffer.from(body).toString('utf8') : '';
    try { body = JSON.parse(text); } catch { body = null; }
  }
  const code = body?.error?.code ?? body?.code;
  assert.equal(code, 'LOCAL_ENTRY_ONLY', `${message}（错误码应为 LOCAL_ENTRY_ONLY）`);
}

/** 以指定员工 UID 启动一次服务，用于验证非管理员的员工管理授权。 */
async function withIdentityServer(uid, assertions, probePath = '/orders', readyStatuses = null) {
  const identityPort = port + 900 + fixturePortOffset++;
  const identityOrigin = `http://127.0.0.1:${identityPort}`;
  let identityLogs = '';
  const identityServer = spawn(process.execPath, ['build'], { env: { ...process.env, DATABASE_PATH: databasePath, NODE_ENV: 'test', OA_TEST_AUTH_BYPASS: '1', OA_TEST_UID: String(uid), PORT: String(identityPort), ORIGIN: identityOrigin }, stdio: ['ignore', 'pipe', 'pipe'] });
  identityServer.stdout.on('data', (chunk) => { identityLogs += chunk; });
  identityServer.stderr.on('data', (chunk) => { identityLogs += chunk; });
  try {
    await waitForServer(identityOrigin, () => identityLogs, identityServer, probePath, readyStatuses);
    await assertions(identityOrigin);
  } finally {
    identityServer.kill('SIGTERM');
  }
}

/** 不注入测试身份启动一次服务，用于验证未登录时 AI 网页接口统一返回 410。 */
async function withAnonymousServer(assertions) {
  const anonymousPort = port + 1200 + fixturePortOffset++;
  const anonymousOrigin = `http://127.0.0.1:${anonymousPort}`;
  let anonymousLogs = '';
  const anonymousEnv = { ...process.env, DATABASE_PATH: databasePath, NODE_ENV: 'test', PORT: String(anonymousPort), ORIGIN: anonymousOrigin, ARTIFACT_APP_ID: '' };
  delete anonymousEnv.OA_TEST_AUTH_BYPASS;
  delete anonymousEnv.OA_TEST_UID;
  const anonymousServer = spawn(process.execPath, ['build'], { env: anonymousEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  anonymousServer.stdout.on('data', (chunk) => { anonymousLogs += chunk; });
  anonymousServer.stderr.on('data', (chunk) => { anonymousLogs += chunk; });
  try {
    await waitForServer(anonymousOrigin, () => anonymousLogs, anonymousServer, '/api/employees', [401]);
    await assertions(anonymousOrigin);
  } finally {
    anonymousServer.kill('SIGTERM');
  }
}

/** 等待独立本机入口就绪：用 node:http 原生请求探测（fetch 会带上被入口拒绝的 Fetch metadata）。 */
async function waitForLocalServer() {
  let lastStatus = '无响应';
  for (let index = 0; index < 80; index++) {
    if (localServer.exitCode !== null) throw new Error(`本机入口已退出（code ${localServer.exitCode}）\n${localLogs}`);
    try {
      const probe = await rawHttp(localOrigin, '/api/ai/me');
      lastStatus = String(probe.status);
      if (probe.status === 200) {
        try {
          if (JSON.parse(probe.body.toString('utf8'))?.data?.mode === 'local_entry') return;
        } catch { /* 响应仍在启动中 */ }
      }
      if (probe.status >= 500) throw new Error(`本机入口启动失败（HTTP ${probe.status}）\n${localLogs}`);
    } catch (reason) {
      if (reason instanceof Error && reason.message.startsWith('本机入口')) throw reason;
      /* 端口未就绪，重试 */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`本机入口启动超时（最后状态：${lastStatus}）\n${localLogs}`);
}

try {
  if (!existsSync(localEntryPath)) {
    throw new Error('缺少 build-local/server.js，请先执行 npm run build:local');
  }
  await waitForServer();
  localServer = spawn(process.execPath, [localEntryPath], {
    env: { ...process.env, DATABASE_PATH: databasePath, NODE_ENV: 'test', OA_LOCAL_PORT: String(localPort) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  localServer.stdout.on('data', (chunk) => { localLogs += chunk; });
  localServer.stderr.on('data', (chunk) => { localLogs += chunk; });
  await waitForLocalServer();
  let result = await request('/api/employees');
  assert.equal(result.response.status, 200, '固定 Catsco 管理员可管理员工');
  result = await request('/api/employees', { method: 'PATCH', json: { uid: 826, display_name: '伪造管理员', department: '', role: 'owner', active: true } });
  assert.equal(result.response.status, 400, '固定管理员身份不能被员工档案修改或授予');
  result = await request('/api/orders');
  assert.equal(result.response.status, 200, '工作台 API 不应要求登录');
  assert.equal(result.response.headers.get('cache-control'), null, 'API 不应继承页面缓存策略');
  result = await request('/admin');
  assert.equal(result.response.status, 200, '系统管理员可通过网址直接进入 admin 页面');
  assert.match(Buffer.from(result.data).toString(), /我的额外业务身份/);
  // 网页不再挂载 AI 接口：管理员浏览器身份访问 /api/ai/* 也是 410，AI 只能走独立本机入口。
  assertWebAiOffline(await requestOn(origin, '/api/ai/me'), '管理员浏览器身份不能通过网页读取 AI 身份');
  assertWebAiOffline(await requestOn(origin, '/api/ai/catalog'), '管理员浏览器身份不能通过网页获取 AI 工具清单');
  result = await request('/orders');
  assert.equal(result.response.headers.get('cache-control'), 'no-store', '页面 HTML 不应缓存');
  assert.doesNotMatch(Buffer.from(result.data).toString(), /href="\/admin"|管理员入口/, '工作台导航不应出现 admin 入口');
  const setExtraIdentity = new FormData();
  setExtraIdentity.append('role', 'finance');
  result = await request('/admin?/saveExtraIdentity', { method: 'POST', body: setExtraIdentity });
  assert.equal(result.response.status, 200, '设置额外身份 action 应返回 SvelteKit redirect 响应');
  assert.equal(result.data.type, 'redirect');
  assert.equal(result.data.location, './orders');
  result = await request('/orders');
  assert.match(Buffer.from(result.data).toString(), /财务身份/, '管理员普通页面应使用已设置的财务身份');
  result = await request('/api/orders');
  assert.equal(result.response.status, 200, '财务身份可以查看订单');
  result = await request('/api/orders/export?mode=detail');
  assert.equal(result.response.status, 200, '财务身份可以导出订单');
  result = await request('/api/catalog/sources', { method: 'POST', json: { kind: 'cost', owner_name: '财务身份验证库', source_file: 'finance-check.csv' } });
  assert.equal(result.response.status, 403, '财务不能新增/导入报价成本库');
  // 网页 AI 路由已下线：财务额外身份同样只能得到 410，且不会写入任何数据。
  assertWebAiOffline(await requestOn(origin, '/api/ai/me'), '财务额外身份不能通过网页读取 AI 身份');
  assertWebAiOffline(await requestOn(origin, '/api/ai/catalog'), '财务额外身份不能通过网页获取 AI 工具清单');
  assertWebAiOffline(
    await requestOn(origin, '/api/ai/catalog', { method: 'POST', json: { tool: 'search_items', arguments: { kind: 'cost', q: 'AI-SMOKE' } } }),
    '财务额外身份不能通过网页调用 AI 小工具'
  );
  assertWebAiOffline(
    await requestOn(origin, '/api/ai/catalog', { method: 'POST', json: { tool: 'create_source', arguments: { kind: 'cost', owner_name: 'AI-SMOKE-财务越权库', dry_run: false } } }),
    '财务额外身份不能通过网页新建资料库'
  );
  assert.equal(readDb((db) => db.prepare("SELECT COUNT(*) FROM catalog_sources WHERE owner_name='AI-SMOKE-财务越权库'").pluck().get()), 0, '被拒绝的 AI 调用不应写入资料库');
  const clearExtraIdentity = new FormData();
  result = await request('/admin?/clearExtraIdentity', { method: 'POST', body: clearExtraIdentity });
  assert.equal(result.response.status, 200, '管理员可通过 admin 页面移除额外身份');
  assert.equal(result.data.type, 'redirect');
  assert.equal(result.data.location, './admin');

  result = await request('/api/customer-profiles', { method: 'POST', json: { name: '测试客户', contact: '测试联系人' } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  const customerId = result.data.data.id;
  result = await request('/api/projects', { method: 'POST', json: { customer_id: customerId, name: '测试项目', owner: '项目负责人' } });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  const projectId = result.data.data.id;

  result = await request('/api/catalog/sources', { method: 'POST', json: { kind: 'cost', owner_name: '测试厂商', source_file: 'cost.csv', actor: '财务甲' } });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  const sourceId = result.data.data.id;
  const catalogFile = new Blob(['name,unit,cost_unit\nprint,sqm,10.50\n,item,5'], { type: 'text/csv' });
  const preview = new FormData();
  preview.append('mode', 'preview');
  preview.append('file', catalogFile, 'cost.csv');
  result = await request('/api/catalog/import', { method: 'POST', body: preview });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.valid_rows, 1);
  assert.equal(result.data.data.ignored_rows, 1);
  const catalogImport = new FormData();
  catalogImport.append('mode', 'import');
  catalogImport.append('replace', 'true');
  catalogImport.append('source_id', sourceId);
  catalogImport.append('actor', '财务甲');
  catalogImport.append('file', catalogFile, 'cost.csv');
  result = await request('/api/catalog/import', { method: 'POST', body: catalogImport });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.data.imported, 1);

  result = await request('/api/catalog/sources', { method: 'POST', json: { kind: 'cost', owner_name: '测试厂商副本', copy_from_id: sourceId, actor: '财务甲' } });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.data.item_count, 1, '沿用资料库时应复制有效条目');
  const copiedSourceId = result.data.data.id;
  result = await request('/api/catalog');
  assert.equal(result.data.data.cost.filter((item) => item.source_id === copiedSourceId).length, 1, '沿用后的资料库应可直接用于录单');

  const createPayload = { project_id: projectId, order_date: '2026-09-16', delivery_date: '2026-09-20', designer: '设计师甲', created_by: '填写人甲', idempotency_key: 'smoke-order-1', products: [{ name: '测试产品', unit: '项', quantity: 2, unit_price: '12.34', cost_unit: '3.3333', specification: '测试要求', remark: '行备注甲', advance: true }], costs: [{ name: '制作成本', vendor: '测试厂商', unit: '项', quantity: 2, unit_price: '3.3333' }] };
  result = await request('/api/orders', { method: 'POST', json: createPayload });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.data.created_by, 'catsco', '录入人必须取自可信的登录身份，而非客户端提交值');
  assert.equal(result.data.data.quote_amount, 2468);
  assert.equal(result.data.data.cost_amount, 667);
  assert.equal(result.data.data.status, '已提交', '新订单默认状态应为已提交');
  assert.equal((result.data.data.advances || []).length, 1, '勾选个人垫付的产品应在保存订单时自动生成报销');
  assert.equal(result.data.data.advances[0].amount, 6.67, '个人垫付金额应为该行成本合计');
  assert.equal(result.data.data.advances[0].status, '待上传证明', '自动生成的报销应先进入待上传证明');
  assert.equal(result.data.data.advances[0].source_line_id, result.data.data.products[0].line_id, '自动报销应关联到具体订单行');
  assert.equal(result.data.data.products[0].advance, true, '订单行应回显个人垫付状态');
  assert.equal(result.data.data.products[0].remark, '行备注甲', '订单项行备注应随产品保存并返回');
  const orderId = result.data.data.id;
  const advanceId = result.data.data.advances[0].id;
  result = await request('/api/reimbursements?scope=review');
  assert.ok(!result.data.data.some((item) => item.id === advanceId), '待上传证明的垫付不应提前进入审核队列');
  result = await request(`/api/reimbursements/${advanceId}/submit-proof`, { method: 'POST', json: {} });
  assert.equal(result.response.status, 400, '未上传证明时不能提交审核');
  const proofForm = new FormData();
  proofForm.append('kind', 'proof');
  proofForm.append('file', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'payment.png');
  result = await request(`/api/reimbursements/${advanceId}/attachments`, { method: 'POST', body: proofForm });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.data.attachment_kind, 'proof', '付款截图应单独标记为 proof 附件');
  result = await request(`/api/reimbursements/${advanceId}/submit-proof`, { method: 'POST', json: {} });
  assert.equal(result.response.status, 400, '只有付款截图、缺少发票时不能提交审核');
  const proofInvoiceForm = new FormData();
  proofInvoiceForm.append('kind', 'invoice');
  proofInvoiceForm.append('file', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'advance-invoice.png');
  result = await request(`/api/reimbursements/${advanceId}/attachments`, { method: 'POST', body: proofInvoiceForm });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  result = await request(`/api/reimbursements/${advanceId}/submit-proof`, { method: 'POST', json: {} });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.reimbursement_status, '待一级审核', '补传付款截图和发票后应进入一级审核');

  // sandbox iframe 的 Origin 可能为 null；带可信请求头的 multipart 上传必须可用，且大于 512KB 也不能被默认上限拦截。
  const edgeReimbursement = await request('/api/reimbursements', { method: 'POST', json: { item: '上传边界测试', amount: '3.00', advance_date: '2026-09-19' } });
  const edgeReimbursementId = edgeReimbursement.data.data.id;
  const largePng = new Uint8Array(600 * 1024);
  largePng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const largeProofForm = new FormData();
  largeProofForm.append('kind', 'proof');
  largeProofForm.append('file', new Blob([largePng], { type: 'image/png' }), 'large-proof.png');
  let rawUpload = await fetch(`${origin}/api/reimbursements/${edgeReimbursementId}/attachments`, {
    method: 'POST', headers: { origin: 'null', 'x-oa-request': '1' }, body: largeProofForm
  });
  assert.equal(rawUpload.status, 201, '带 X-OA-Request 的 sandbox iframe 大文件上传应成功');
  const untrustedProofForm = new FormData();
  untrustedProofForm.append('kind', 'proof');
  untrustedProofForm.append('file', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'untrusted.png');
  rawUpload = await fetch(`${origin}/api/reimbursements/${edgeReimbursementId}/attachments`, {
    method: 'POST', headers: { origin: 'null' }, body: untrustedProofForm
  });
  assert.equal(rawUpload.status, 403, '缺少可信请求头的 null Origin 表单上传应被拒绝');
  result = await request(`/api/reimbursements/${edgeReimbursementId}`, { method: 'DELETE' });
  assert.equal(result.response.status, 200, '上传边界测试记录应可清理');
  result = await request('/api/reimbursements?scope=review');
  assert.ok(result.data.data.some((item) => item.id === advanceId), '提交证明后应进入审核队列');
  result = await request('/api/orders', { method: 'POST', json: createPayload });
  assert.equal(result.data.data.id, orderId, '重复提交必须返回原订单');
  assert.equal(readDb((db) => db.prepare('SELECT COUNT(*) FROM reimbursements_simple WHERE order_id=?').pluck().get(orderId)), 1, '重复提交不应重复生成个人垫付报销');
  assert.deepEqual(readDb((db) => db.prepare('SELECT unit_price,subtotal FROM order_costs WHERE order_id=?').get(orderId)), { unit_price: 333, subtotal: 667 }, '成本单价可反算为多位小数，入库应四舍五入到分且保留行合计');

  for (const fileName of ['note-a.png', 'note-b.png']) {
    const attachment = new FormData();
    attachment.append('file', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), fileName);
    result = await request(`/api/orders/${orderId}/attachments`, { method: 'POST', body: attachment });
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
  }
  result = await request(`/api/orders/${orderId}/attachments`);
  assert.equal(result.data.data.length, 2, '多附件应按文件独立上传并全部保留');

  result = await request(`/api/orders/${orderId}/complete`, { method: 'POST', body: new FormData() });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.status, '已完成', '录入人（执行）可将订单标记为已完成');

  result = await request(`/api/orders/${orderId}`, { method: 'PATCH', json: { project_id: projectId, order_date: '2026-09-16', delivery_date: '2026-09-21', designer: '设计师乙', created_by: '填写人乙', payment_status: '已结款', status: '已完成', note: '整单备注', products: [{ name: '测试产品', unit: '项', quantity: 1, unit_price: '20.00', remark: '行备注乙' }, { name: '测试产品二', unit: '项', quantity: 1, unit_price: '5.00' }], costs: [], advances: [] } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.created_by, 'catsco');
  assert.equal(result.data.data.products[0].remark, '行备注乙', '编辑订单应保留行备注');
  assert.equal(result.data.data.products[1].remark, '', '未填行备注的订单项应为空字符串');
  assert.equal((result.data.data.advances || []).length, 0, '取消个人垫付后应清理尚未审核的自动报销');

  result = await request(`/api/orders/export?ids=${encodeURIComponent(orderId)}&mode=detail&columns=code,product_name,product_remark,quote_amount&expand=false&total=true&actor=财务甲`);
  assert.equal(result.response.status, 200);
  let workbook = XLSX.read(Buffer.from(result.data), { type: 'buffer' });
  let exportRows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });
  assert.equal(exportRows.length, 3, '订单明细应包含表头、订单行和合计行');
  assert.equal(exportRows[2][0], '合计');
  assert.equal(exportRows[0][2], '行备注', '订单明细应支持导出行备注列');
  assert.equal(exportRows[1][2], '行备注乙', '导出的行备注应取自订单项而非订单备注');
  result = await request(`/api/orders/export?ids=${encodeURIComponent(orderId)}&mode=settlement&followA=${encodeURIComponent('甲方联系人')}&followB=${encodeURIComponent('乙方跟进人')}&contactPhone=123456&actor=财务甲`);
  assert.equal(result.response.status, 200);
  const settlementBuffer = Buffer.from(result.data);
  workbook = XLSX.read(settlementBuffer, { type: 'buffer', cellStyles: true, cellFormula: true });
  const settlementSheet = workbook.Sheets[workbook.SheetNames[0]];
  const settlementXml = strFromU8(unzipSync(settlementBuffer)['xl/worksheets/sheet1.xml']);
  exportRows = XLSX.utils.sheet_to_json(settlementSheet, { header: 1, defval: '' });
  assert.equal(workbook.SheetNames[0], '结算', '结算单工作表名称应与模板一致');
  assert.deepEqual(exportRows[6].slice(0, 8), ['序号', '产品名称', '单位', '数量', '规格和技术要求', '单价(元）', '小计（元）', '备注']);
  const settlementProductRow = exportRows.find((row) => row[1] === '测试产品');
  assert.equal(settlementProductRow?.[7], '行备注乙', '结算单备注列应优先使用行备注');
  const settlementFallbackRow = exportRows.find((row) => row[1] === '测试产品二');
  assert.equal(settlementFallbackRow?.[7], '整单备注', '行备注为空时应回退到订单备注');
  assert.match(String(exportRows.flat().find((cell) => String(cell).includes('甲方项目跟进人')) || ''), /甲方联系人/);
  assert.ok((settlementSheet['!merges'] || []).some((merge) => merge.s.r === 0 && merge.s.c === 0 && merge.e.r === 0 && merge.e.c === 8), '结算单标题应合并 A1:I1');
  assert.ok((settlementSheet['!cols'] || []).length >= 9, '结算单应保留模板的九列布局');
  assert.ok(settlementSheet['!cols'][4].wch / settlementSheet['!cols'][1].wch > 2.7, '结算单规格列宽应复刻模板比例');
  assert.match(settlementXml, /<pageSetup[^>]*paperSize="9"[^>]*orientation="portrait"[^>]*fitToWidth="1"/, '结算单应使用 A4 纵向并缩放到一页宽');
  assert.doesNotMatch(settlementXml, /<fgColor rgb="(?:E7E6E6|D9EAD3|FFF2CC)"/, '结算单不应保留旧版彩色填充');
  assert.ok(Object.values(settlementSheet).some((cell) => cell && typeof cell === 'object' && 'f' in cell && String(cell.f).includes('SUM(G')), '结算单应包含分类小计公式');

  result = await request('/api/reimbursements', { method: 'POST', json: { employee: '填写人甲', item: '无效零金额', amount: '0', advance_date: '2026-09-16', order_id: orderId } });
  assert.equal(result.response.status, 400, '零金额报销必须被服务端拒绝');
  result = await request('/api/reimbursements', { method: 'POST', json: { employee: '填写人甲', item: '交通费', amount: '12.34', advance_date: '2026-09-16', order_id: orderId } });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  const reimbursementId = result.data.data.id;
  result = await request('/api/orders');
  assert.ok((result.data.data.find((item) => item.id === orderId).advances || []).some((item) => item.id === reimbursementId), '订单显示时应自动包含关联的报销');
  async function setAdminWorkflowRole(role) {
    const form = new FormData();
    form.append('role', role);
    const response = await request('/admin?/saveExtraIdentity', { method: 'POST', body: form });
    assert.equal(response.response.status, 200, `管理员切换为${role}身份应成功`);
  }
  result = await request('/api/reimbursements?scope=review');
  assert.ok(result.data.data.some((item) => item.id === reimbursementId), '管理员应能看到待审核报销');
  assert.ok(result.data.data.every((item) => item.reimbursement_status === '待一级审核'), '管理员只应看到待审核节点');
  await setAdminWorkflowRole('owner');
  result = await request('/api/reimbursements?scope=mine&status=未报销');
  assert.ok(result.data.data.some((item) => item.id === reimbursementId), '未报销筛选应包含待审核记录');
  result = await request(`/api/reimbursements/${reimbursementId}`, { method: 'PATCH', json: { status: '已打回', reject_reason: '请补充发票', actor: '财务甲' } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.reimbursement_status, '已打回');
  const invoice = new FormData();
  invoice.append('file', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'invoice.png');
  result = await request(`/api/reimbursements/${reimbursementId}/attachments`, { method: 'POST', body: invoice });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  result = await request('/api/reimbursements?scope=mine&person=catsco');
  assert.equal(result.data.data.find((item) => item.id === reimbursementId).reimbursement_status, '待一级审核', '补传发票后应回到管理人审核');
  result = await request('/api/reimbursements/batch', { method: 'POST', json: { ids: [reimbursementId], status: '待执行' } });
  assert.notEqual(result.response.status, 200, '不允许跳过审核、复核和确认');
  await request('/admin?/clearExtraIdentity', { method: 'POST', body: new FormData() });
  result = await request('/api/reimbursements/batch', { method: 'POST', json: { ids: [reimbursementId], status: '待二级审核' } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  for (const target of ['待三级审核', '已打回']) {
    for (const batch of [false, true]) {
      result = await request(batch ? '/api/reimbursements/batch' : `/api/reimbursements/${reimbursementId}`, {
        method: batch ? 'POST' : 'PATCH', json: { ...(batch ? { ids: [reimbursementId] } : {}), status: target, reject_reason: '越权测试' },
      });
      assert.equal(result.response.status, 403, '管理员不能复核或打回财务节点，单条与批量均应拦截');
    }
  }
  await setAdminWorkflowRole('finance');
  result = await request('/api/reimbursements/batch', { method: 'POST', json: { ids: [reimbursementId], status: '待三级审核' } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  result = await request('/api/reimbursements/batch', { method: 'POST', json: { ids: [reimbursementId], status: '待执行' } });
  assert.equal(result.response.status, 403, '财务不能代替老板确认');
  await request('/admin?/clearExtraIdentity', { method: 'POST', body: new FormData() });
  result = await request(`/api/reimbursements/${reimbursementId}`, { method: 'PATCH', json: { status: '待执行' } });
  assert.equal(result.response.status, 403, '管理员不能代替老板确认');
  await setAdminWorkflowRole('owner');
  result = await request('/api/reimbursements/batch', { method: 'POST', json: { ids: [reimbursementId], status: '待执行' } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  const confirmedReimbursement = result.data.data[0];
  result = await request('/api/reimbursements/batch', { method: 'POST', json: { ids: [reimbursementId], status: '已执行' } });
  assert.equal(result.response.status, 403, '老板不能代替财务执行');
  await request('/admin?/clearExtraIdentity', { method: 'POST', body: new FormData() });
  result = await request(`/api/reimbursements/${reimbursementId}`, { method: 'PATCH', json: { status: '已执行' } });
  assert.equal(result.response.status, 403, '管理员不能代替财务执行');
  await setAdminWorkflowRole('finance');
  const automaticVoucherNo = confirmedReimbursement.voucher_no;
  assert.ok(automaticVoucherNo, '老板确认后应自动生成单据');
  result = await request('/api/reimbursements/batch', { method: 'POST', json: { ids: [reimbursementId], status: '已执行' } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  result = await request('/api/reimbursements?scope=mine&status=未报销');
  assert.ok(!result.data.data.some((item) => item.id === reimbursementId), '未报销筛选不应包含已付款记录');
  result = await request('/api/reimbursements?scope=history');
  assert.ok(result.data.data.some((item) => item.id === reimbursementId), '历史报销应包含已执行记录');
  assert.ok(result.data.data.every((item) => item.reimbursement_status === '已执行'), '历史报销只应包含已完成记录');
  const clearWorkflowRole = new FormData();
  result = await request('/admin?/clearExtraIdentity', { method: 'POST', body: clearWorkflowRole });
  assert.equal(result.response.status, 200, '流程测试后应清除管理员额外身份');

  // 修改已审核报销的金额后，必须退回上一审核节点并标记内容已修改。
  result = await request('/api/reimbursements', { method: 'POST', json: { item: '金额退回测试', amount: '20.00', advance_date: '2026-09-20' } });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  const rollbackReimbursementId = result.data.data.id;
  result = await request(`/api/reimbursements/${rollbackReimbursementId}`, { method: 'PATCH', json: { status: '待二级审核' } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  result = await request(`/api/reimbursements/${rollbackReimbursementId}/amount-change`, { method: 'POST', json: { amount: '25.00', reason: '实际付款金额不同' } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.amount, 2500, '申请修改金额应更新报销金额');
  assert.equal(result.data.data.content_modified, 1, '修改后的报销应标记内容已修改');
  assert.equal(result.data.data.reimbursement_status, '待一级审核', '已审核报销修改金额后应退回上一审核节点');
  result = await request('/api/reimbursements?scope=mine');
  const rollbackRow = result.data.data.find((item) => item.id === rollbackReimbursementId);
  assert.equal(rollbackRow?.amount_change_note, '实际付款金额不同', '报销列表应返回金额修改原因');
  result = await request('/api/reimbursements?scope=review');
  assert.ok(result.data.data.some((item) => item.id === rollbackReimbursementId), '退回后应重新进入一级审核队列');
  result = await request(`/api/reimbursements/${rollbackReimbursementId}`, { method: 'DELETE' });
  assert.equal(result.response.status, 200, '测试后应可删除退回待审核的报销');

  result = await request(`/api/orders/${orderId}`,  { method: 'PATCH', json: { project_id: projectId, order_date: '2026-09-16', delivery_date: '2026-09-21', designer: '设计师乙', created_by: '填写人乙', payment_status: '已结款', status: '已完成', products: [{ name: '测试产品', unit: '项', quantity: 1, unit_price: '20.00', remark: '行备注丙' }], costs: [], advances: [] } });
  assert.equal(result.response.status, 200, '订单更新应忽略垫付字段且不影响已关联的报销');
  assert.ok((result.data.data.advances || []).some((item) => item.id === reimbursementId), '订单更新后仍应显示关联的报销');
  result = await request(`/api/reimbursements/${reimbursementId}/voucher`, { method: 'POST' });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  const voucherNo = result.data.data.voucher_no;
  assert.equal(voucherNo, automaticVoucherNo, '手动生成不能替换自动生成的单号');
  result = await request(`/api/reimbursements/${reimbursementId}/voucher`, { method: 'POST' });
  assert.equal(result.data.data.voucher_no, voucherNo, '重复生成必须保持同一单号');
  result = await request(`/api/reimbursements/${reimbursementId}/archive`, { method: 'POST', json: { actor: '财务甲' } });
  assert.equal(result.response.status, 200);
  result = await request('/api/reimbursements/export?mode=detail&actor=财务甲');
  assert.equal(result.response.status, 200);
  assert.match(result.response.headers.get('content-type') || '', /spreadsheet/);

  const db = new Database(databasePath, { readonly: true });
  assert.equal(db.prepare("SELECT value FROM schema_meta WHERE key='order_app_version'").pluck().get(), '35');
  assert.ok(db.prepare("SELECT COUNT(*) FROM pragma_table_info('catalog_sources') WHERE name='library_name'").pluck().get(), 'v30 应为资料库补充名称字段');
  assert.equal(db.prepare("PRAGMA index_list('catalog_sources')").all().filter((index) => index.unique && index.origin !== 'pk').length, 0, 'v30 应移除客户/厂商唯一限制，允许同一客户多个报价库');
  assert.equal(db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('catalog_quote_items','catalog_cost_items')").pluck().get(), 2, 'v27 应创建报价库/成本库分表');
  assert.equal(db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='catalog_items'").pluck().get(), 0, 'v27 应移除旧的 catalog_items');
  assert.equal(db.prepare("SELECT COUNT(*) FROM pragma_table_info('orders_simple') WHERE name='catalog_id'").pluck().get(), 0, 'v27 应移除 orders_simple.catalog_id');
  assert.ok(db.prepare("SELECT COUNT(*) FROM pragma_table_info('orders_simple') WHERE name='order_source'").pluck().get(), 'v29 应包含订单来源字段');
  assert.equal(db.prepare("SELECT COUNT(*) FROM pragma_table_info('orders_simple') WHERE name IN ('contact','customer_department')").pluck().get(), 0, 'v29 应移除客户部门与联系人字段');
  assert.ok(db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='catalog_cost_items'").pluck().get(), '成本库分表应存在');
  assert.ok(db.prepare("SELECT COUNT(*) FROM pragma_table_info('catalog_quote_items') WHERE name='price_incl_tax'").pluck().get(), '报价库应保留统一单价字段');
  assert.equal(db.prepare("SELECT COUNT(*) FROM pragma_table_info('catalog_cost_items') WHERE name IN ('cost_unit_excl_tax','tax_rate')").pluck().get(), 0, '成本库不应区分税率或不含税价格');
  assert.equal(db.prepare("SELECT COUNT(*) FROM pragma_table_info('catalog_quote_items') WHERE name IN ('price_excl_tax','tax_rate')").pluck().get(), 0, '报价库不应区分税率或不含税价格');
  assert.ok(db.prepare("SELECT COUNT(*) FROM pragma_table_info('catalog_cost_items') WHERE name='cost_unit'").pluck().get(), '成本库应含成本单价字段');
  assert.ok(db.prepare("SELECT COUNT(*) FROM pragma_table_info('reimbursements_simple') WHERE name='source_line_id'").pluck().get(), 'v31 应为报销补充订单行关联字段');
  assert.equal(db.prepare("SELECT COUNT(*) FROM pragma_table_info('reimbursements_simple') WHERE name IN ('amount_adjusted','content_modified','content_modified_at','amount_change_note')").pluck().get(), 4, 'v34 应为报销补充金额修改与内容标记字段');
  assert.ok(db.prepare("SELECT COUNT(*) FROM pragma_table_info('audit_logs') WHERE name='actor_uid'").pluck().get(), '审计表应包含操作者 UID');
  assert.equal(db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='customers_simple'").pluck().get(), 0, 'v33 应移除旧客户表');
  assert.ok(db.prepare('SELECT COUNT(*) FROM customer_profiles').pluck().get() >= 1, 'v33 订单客户应来自客户管理档案');
  assert.equal(db.prepare('SELECT COUNT(*) FROM orders_simple o LEFT JOIN customer_profiles c ON c.id=o.customer_id WHERE c.id IS NULL').pluck().get(), 0, '订单客户应能关联到客户档案');
  assert.equal(db.prepare("SELECT COUNT(*) FROM reimbursements_simple WHERE source_line_id<>''").pluck().get(), 0, '取消垫付后不应残留自动报销记录');
  assert.ok(db.prepare('SELECT COUNT(*) FROM audit_logs WHERE actor_uid=826').pluck().get() >= 1, '审计应记录操作者 UID');
  assert.equal(db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='system_admin_identity'").pluck().get(), 1, '系统管理员额外身份应持久化保存');
  assert.equal(db.prepare('SELECT COUNT(*) FROM system_admin_identity').pluck().get(), 0, '清除额外身份后应回到系统管理员身份');
  assert.equal(db.prepare('SELECT COUNT(*) FROM orders_simple').pluck().get(), 1, '幂等键不能产生重复订单');
  assert.equal(db.prepare('SELECT created_by_uid FROM orders_simple LIMIT 1').pluck().get(), 826, '订单录入人应关联可信的 Catsco UID');
  assert.ok(db.prepare("SELECT COUNT(*) FROM pragma_table_info('orders_simple') WHERE name IN ('created_by_uid','designer_uid','planner_uid')").pluck().get() === 3, '订单应保存员工 UID 关联');
  assert.equal(db.prepare("SELECT COUNT(*) FROM pragma_table_info('order_products') WHERE name='remark'").pluck().get(), 1, '订单项表应包含行备注列');
  assert.equal(db.prepare("SELECT remark FROM order_products WHERE name='测试产品'").pluck().get(), '行备注丙', '行备注应写入规范化的订单项表');
  assert.equal(db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('users','sessions')").pluck().get(), 0, '全新数据库不应创建登录或角色表');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.ok(db.prepare('SELECT COUNT(*) FROM audit_logs').pluck().get() >= 5);
  db.close();

  await withMigratedFixture('oa-v23.db', '23', (legacy) => {
    restoreLegacyCatalog(legacy);
    legacy.exec('ALTER TABLE order_products DROP COLUMN remark');
    // 全新库已加 status CHECK；测试旧值归并时临时关闭校验写入历史脏值。
    legacy.pragma('ignore_check_constraints = ON');
    legacy.prepare("UPDATE orders_simple SET status='待确认'").run();
    legacy.pragma('ignore_check_constraints = OFF');
  }, (migrated) => {
    assert.equal(migrated.prepare("SELECT value FROM schema_meta WHERE key='order_app_version'").pluck().get(), '35');
    assert.ok(migrated.prepare("SELECT COUNT(*) FROM pragma_table_info('audit_logs') WHERE name='actor_uid'").pluck().get(), 'v23 数据库迁移后应补齐审计 actor_uid');
    assert.equal(migrated.prepare('SELECT COUNT(*) FROM orders_simple').pluck().get(), 1, 'v23 数据库重启后应保留订单');
    assert.equal(migrated.prepare('SELECT order_source FROM orders_simple LIMIT 1').pluck().get(), '旧部门-旧联系人', 'v29 迁移应按部门-联系人合并订单来源');
    assert.equal(migrated.prepare("SELECT COUNT(*) FROM pragma_table_info('orders_simple') WHERE name IN ('contact','customer_department')").pluck().get(), 0, 'v29 迁移后应移除旧的两列');
    assert.equal(migrated.prepare('SELECT status FROM orders_simple LIMIT 1').pluck().get(), '已提交', 'v26 迁移应将历史订单状态归并为已提交');
    assert.ok(migrated.prepare("SELECT COUNT(*) FROM pragma_table_info('order_products') WHERE name='remark'").pluck().get(), '迁移后订单项应补齐行备注字段');
  });

  // v27 数据库升级时移除税务列，并保留订单明细关联。
  await withMigratedFixture('oa-v27.db', '27', (legacy) => {
    legacy.pragma('foreign_keys = OFF');
    legacy.exec(`
      DROP TABLE catalog_quote_items;
      DROP TABLE catalog_cost_items;
      CREATE TABLE catalog_quote_items(id TEXT PRIMARY KEY,source_id TEXT,active INTEGER NOT NULL DEFAULT 1,item_no TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT '',name TEXT NOT NULL,specification TEXT NOT NULL DEFAULT '',unit TEXT NOT NULL DEFAULT '项',estimated_quantity TEXT NOT NULL DEFAULT '',price_incl_tax INTEGER NOT NULL DEFAULT 0,price_excl_tax INTEGER NOT NULL DEFAULT 0,tax_rate TEXT NOT NULL DEFAULT '',max_price INTEGER NOT NULL DEFAULT 0,customer_name TEXT NOT NULL DEFAULT '',project_name TEXT NOT NULL DEFAULT '',remark TEXT NOT NULL DEFAULT '',source_file TEXT NOT NULL DEFAULT '',source_sheet TEXT NOT NULL DEFAULT '',source_type TEXT NOT NULL DEFAULT 'customer_quote',raw_data TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,UNIQUE(category,name,customer_name,project_name,specification,estimated_quantity));
      CREATE TABLE catalog_cost_items(id TEXT PRIMARY KEY,source_id TEXT,active INTEGER NOT NULL DEFAULT 1,item_no TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT '',name TEXT NOT NULL,specification TEXT NOT NULL DEFAULT '',unit TEXT NOT NULL DEFAULT '项',supplier_name TEXT NOT NULL DEFAULT '',cost_unit INTEGER NOT NULL DEFAULT 0,cost_unit_excl_tax INTEGER NOT NULL DEFAULT 0,tax_rate TEXT NOT NULL DEFAULT '',min_quantity TEXT NOT NULL DEFAULT '',remark TEXT NOT NULL DEFAULT '',source_file TEXT NOT NULL DEFAULT '',source_sheet TEXT NOT NULL DEFAULT '',source_type TEXT NOT NULL DEFAULT 'supplier_cost',raw_data TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,UNIQUE(category,name,supplier_name,specification));
      CREATE INDEX idx_catalog_quote_source ON catalog_quote_items(source_id,active);
      CREATE INDEX idx_catalog_cost_source ON catalog_cost_items(source_id,active);
    `);
    legacy.pragma('foreign_keys = ON');
  }, (migrated) => {
    assert.equal(migrated.prepare("SELECT value FROM schema_meta WHERE key='order_app_version'").pluck().get(), '35');
    assert.equal(migrated.prepare("SELECT COUNT(*) FROM pragma_table_info('catalog_quote_items') WHERE name IN ('price_excl_tax','tax_rate')").pluck().get(), 0, 'v28 应移除报价税务列');
    assert.equal(migrated.prepare("SELECT COUNT(*) FROM pragma_table_info('catalog_cost_items') WHERE name IN ('cost_unit_excl_tax','tax_rate')").pluck().get(), 0, 'v28 应移除成本税务列');
    assert.equal(migrated.prepare('SELECT COUNT(*) FROM order_products').pluck().get(), 1, '迁移不应丢失订单项');
    assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), [], 'v28 重建资料库表后外键应有效');
  });

  await withMigratedFixture('oa-v18.db', '18', (legacy) => {
    restoreLegacyCatalog(legacy);
    legacy.exec(`
      DROP INDEX IF EXISTS idx_orders_idempotency;
      ALTER TABLE orders_simple DROP COLUMN idempotency_key;
      ALTER TABLE orders_simple ADD COLUMN catalog_id TEXT;
      CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT);
      CREATE TABLE sessions(id TEXT PRIMARY KEY, user_id TEXT);
      ALTER TABLE orders_simple ADD COLUMN created_by_user_id TEXT;
      ALTER TABLE reimbursements_simple ADD COLUMN employee_user_id TEXT;
      ALTER TABLE reimbursements_simple ADD COLUMN voucher_archived_by_user_id TEXT;
      ALTER TABLE order_attachments ADD COLUMN uploaded_by_user_id TEXT;
      ALTER TABLE reimbursement_attachments ADD COLUMN uploaded_by_user_id TEXT;
      ALTER TABLE catalog_sources ADD COLUMN maintained_by_user_id TEXT;
      ALTER TABLE audit_logs ADD COLUMN actor_user_id TEXT;
    `);
  }, (migrated) => {
    assert.equal(migrated.prepare("SELECT value FROM schema_meta WHERE key='order_app_version'").pluck().get(), '35');
    assert.ok(migrated.prepare("SELECT COUNT(*) FROM pragma_table_info('orders_simple') WHERE name='idempotency_key'").pluck().get(), 'v18 数据库应补齐幂等字段');
    assert.equal(migrated.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('users','sessions')").pluck().get(), 0, '迁移后不应保留登录表');
    for (const [table, column] of [['orders_simple', 'created_by_user_id'], ['reimbursements_simple', 'employee_user_id'], ['reimbursements_simple', 'voucher_archived_by_user_id'], ['order_attachments', 'uploaded_by_user_id'], ['reimbursement_attachments', 'uploaded_by_user_id'], ['catalog_sources', 'maintained_by_user_id'], ['audit_logs', 'actor_user_id']]) {
      assert.equal(migrated.prepare(`SELECT COUNT(*) FROM pragma_table_info('${table}') WHERE name=?`).pluck().get(column), 0, `迁移后不应保留 ${table}.${column}`);
    }
    assert.equal(migrated.prepare('SELECT COUNT(*) FROM orders_simple').pluck().get(), 1, '迁移不应丢失订单');
    assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  });

  await withMigratedFixture('oa-v20.db', '20', (legacy) => {
    restoreLegacyCatalog(legacy);
    legacy.exec('ALTER TABLE orders_simple DROP COLUMN planner; ALTER TABLE orders_simple DROP COLUMN execution_company;');
  }, (migrated) => {
    assert.equal(migrated.prepare("SELECT value FROM schema_meta WHERE key='order_app_version'").pluck().get(), '35');
    assert.ok(migrated.prepare("SELECT COUNT(*) FROM pragma_table_info('orders_simple') WHERE name='planner'").pluck().get(), 'v20 数据库应补齐策划人字段');
    assert.ok(migrated.prepare("SELECT COUNT(*) FROM pragma_table_info('orders_simple') WHERE name='execution_company'").pluck().get(), 'v20 数据库应补齐执行公司字段');
    assert.equal(migrated.prepare('SELECT COUNT(*) FROM orders_simple').pluck().get(), 1, 'v20 迁移不应丢失订单');
    assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  });

  await withMigratedFixture('oa-v21.db', '21', (legacy) => {
    restoreLegacyCatalog(legacy);
    legacy.exec('ALTER TABLE orders_simple DROP COLUMN execution_company;');
  }, (migrated) => {
    assert.equal(migrated.prepare("SELECT value FROM schema_meta WHERE key='order_app_version'").pluck().get(), '35');
    assert.ok(migrated.prepare("SELECT COUNT(*) FROM pragma_table_info('orders_simple') WHERE name='execution_company'").pluck().get(), 'v21 数据库应补齐执行公司字段');
    assert.equal(migrated.prepare('SELECT COUNT(*) FROM orders_simple').pluck().get(), 1, 'v21 迁移不应丢失订单');
    assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  });

  // AI 小工具：本机入口身份/工具清单、默认预览不写库、金额元口径、重复与跨库防护、校验错误与原子性。
  // 所有测试数据均使用 "AI-SMOKE-" 前缀，避免影响其他断言。
  result = await request('/api/ai/me');
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.mode, 'local_entry', 'AI 身份接口应返回本机入口模式');
  assert.equal(result.data.data.kind, undefined, '本机入口不再返回服务 Agent 类型');
  assert.equal(result.data.data.agent_id, undefined, '本机入口不返回 Agent ID');
  assert.equal(result.data.data.display_name, undefined, '本机入口不返回展示名称');
  assert.equal(result.data.data.uid, undefined, '本机入口不绑定浏览器登录 UID');
  assert.equal(result.data.data.username, undefined, 'AI 身份不再返回浏览器用户名');
  assert.equal(result.data.data.role, undefined, 'AI 身份不再返回员工角色');
  assert.equal(result.data.data.active, undefined, 'AI 身份不再返回员工启用状态');
  assert.deepEqual(result.data.data.permissions.catalog, { read: true, manage: true }, '服务 Agent 应可读写资料库');
  assert.equal(result.data.data.permissions.orders.read, true, '服务 Agent 应可读取订单');
  result = await request('/api/ai/catalog');
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  const aiToolNames = result.data.data.tools.map((tool) => tool.name);
  for (const name of ['list_sources', 'search_items', 'create_source', 'upsert_items']) assert.ok(aiToolNames.includes(name), `工具清单应包含 ${name}`);
  const upsertTool = result.data.data.tools.find((tool) => tool.name === 'upsert_items');
  assert.ok(upsertTool?.inputSchema?.properties?.rows ?? upsertTool?.parameters?.properties?.rows, '工具清单应下发行参数');

  // create_source：默认 dry_run 只预览，显式 dry_run=false 才写入；重复来源返回 409。
  result = await aiCall('create_source', { kind: 'cost', owner_name: 'AI-SMOKE-厂商甲' });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.dry_run, true, 'create_source 默认应只预览');
  assert.equal(readDb((db) => db.prepare("SELECT COUNT(*) FROM catalog_sources WHERE owner_name='AI-SMOKE-厂商甲'").pluck().get()), 0, '预览不应写入资料库');
  result = await aiCall('create_source', { kind: 'cost', owner_name: 'AI-SMOKE-厂商甲', dry_run: false });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.dry_run, false, '显式提交应返回写入结果');
  const aiCostSourceId = result.data.data.source.id;
  assert.ok(aiCostSourceId, '写入应返回 source_id');
  result = await aiCall('create_source', { kind: 'cost', owner_name: 'AI-SMOKE-厂商甲', dry_run: false });
  assert.equal(result.response.status, 409, '重复来源必须拒绝');
  assert.equal(result.data.error?.code, 'CONFLICT');

  // upsert_items：默认预览不写库；提交后金额按元存储，搜索返回元字符串而不是放大的分。
  const aiCostRows = [{ category: 'AI-SMOKE-成本类', name: 'AI-SMOKE-喷画', specification: 'AI-SMOKE-规格', unit: 'sqm', cost_unit: '12.34' }];
  result = await aiCall('upsert_items', { source_id: aiCostSourceId, rows: aiCostRows });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.dry_run, true, 'upsert_items 默认应只预览');
  assert.equal(result.data.data.inserted, 1);
  assert.equal(result.data.data.money_unit, 'yuan');
  assert.equal(result.data.data.rows[0].cost_unit, '12.34', '预览金额应为元字符串');
  assert.equal(readDb((db) => db.prepare("SELECT COUNT(*) AS count FROM catalog_cost_items WHERE source_id=? AND name='AI-SMOKE-喷画'").get(aiCostSourceId).count), 0, '预览不应写入条目');
  result = await aiCall('upsert_items', { source_id: aiCostSourceId, rows: aiCostRows, dry_run: false });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.dry_run, false);
  assert.equal(result.data.data.inserted, 1);
  assert.equal(result.data.data.rows[0].cost_unit, '12.34', '返回的金额应为元字符串');
  assert.equal(readDb((db) => db.prepare("SELECT cost_unit,supplier_name FROM catalog_cost_items WHERE source_id=? AND name='AI-SMOKE-喷画'").get(aiCostSourceId).cost_unit), 1234, '库内应以分存储 12.34 元');
  result = await aiCall('search_items', { kind: 'cost', source_id: aiCostSourceId, q: 'AI-SMOKE-喷画' });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.money_unit, 'yuan');
  assert.equal(result.data.data.items.length, 1);
  assert.equal(result.data.data.items[0].cost_unit, '12.34', '搜索返回的金额不应放大 100 倍');
  assert.equal(result.data.data.items[0].supplier_name, 'AI-SMOKE-厂商甲', '成本条目供应商应取资料库名称');

  // 按自然键更新同一行，不新增重复条目。
  result = await aiCall('upsert_items', { source_id: aiCostSourceId, rows: [{ ...aiCostRows[0], cost_unit: '20.00' }], dry_run: false });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.updated, 1, '同自然键应更新而非新增');
  assert.equal(result.data.data.inserted, 0);
  result = await aiCall('search_items', { kind: 'cost', source_id: aiCostSourceId, q: 'AI-SMOKE-喷画' });
  assert.equal(result.data.data.items.length, 1, '更新后不应产生重复条目');
  assert.equal(result.data.data.items[0].cost_unit, '20.00');

  // 批量写入的原子性：任意一行非法则整批不落库。
  result = await aiCall('upsert_items', { source_id: aiCostSourceId, dry_run: false, rows: [
    { category: 'AI-SMOKE-原子性', name: 'AI-SMOKE-合法行', cost_unit: '1.00' },
    { category: 'AI-SMOKE-原子性', name: 'AI-SMOKE-非法行', cost_unit: '1.234' }
  ] });
  assert.equal(result.response.status, 400, '非法金额应被拒绝');
  assert.equal(result.data.error?.path, 'arguments.rows[1].cost_unit');
  assert.equal(readDb((db) => db.prepare("SELECT COUNT(*) FROM catalog_cost_items WHERE name IN ('AI-SMOKE-合法行','AI-SMOKE-非法行')").pluck().get()), 0, '批量失败时不得写入任何行');

  // 错误字段、错误金额、未知工具、企图通过 supplier_name 指定厂商（跨库自然键）均被拒绝。
  result = await aiCall('upsert_items', { source_id: aiCostSourceId, dry_run: false, rows: [{ name: 'AI-SMOKE-越权字段', cost_unit: '1.00', supplier_name: 'AI-SMOKE-其他厂商' }] });
  assert.equal(result.response.status, 400, '不接受 AI 指定供应商');
  assert.equal(result.data.error?.path, 'arguments.rows[0].supplier_name');
  result = await aiCall('upsert_items', { source_id: aiCostSourceId, dry_run: false, rows: [{ name: 'AI-SMOKE-错误金额', cost_unit: '-1' }] });
  assert.equal(result.response.status, 400, '负金额应被拒绝');
  assert.equal(result.data.error?.path, 'arguments.rows[0].cost_unit');
  result = await aiCall('upsert_items', { source_id: aiCostSourceId, dry_run: false, rows: [{ name: 'AI-SMOKE-数字金额', cost_unit: 12.34 }] });
  assert.equal(result.response.status, 400, '金额必须是字符串');
  result = await aiCall('upsert_items', { source_id: aiCostSourceId, dry_run: false, rows: [{ name: 'AI-SMOKE-null金额', cost_unit: null }] });
  assert.equal(result.response.status, 400, 'null 不得被转换成零价格');
  result = await aiCall('upsert_items', { source_id: aiCostSourceId, dry_run: false, rows: [{ name: 'AI-SMOKE-缺价' }] });
  assert.equal(result.response.status, 400, '缺少单价应被拒绝');
  // uid 只能来自 hooks 解析的登录身份，请求体中的 uid 必须拒绝。
  result = await aiCall('create_source', { kind: 'cost', owner_name: 'AI-SMOKE-UID库', uid: 1004 });
  assert.equal(result.response.status, 400, '请求体中的 uid 必须拒绝');
  assert.equal(result.data.error?.path, 'arguments.uid');
  result = await aiCall('upsert_items', { source_id: aiCostSourceId, dry_run: false, rows: [{ name: 'AI-SMOKE-UID行', cost_unit: '1.00', uid: 1004 }] });
  assert.equal(result.response.status, 400, '行内 uid 必须拒绝');
  assert.equal(result.data.error?.path, 'arguments.rows[0].uid');
  assert.equal(readDb((db) => db.prepare("SELECT COUNT(*) FROM catalog_cost_items WHERE name IN ('AI-SMOKE-UID行') OR category='AI-SMOKE-UID库'").pluck().get()), 0, '被拒绝的请求不能写入');
  assert.equal(readDb((db) => db.prepare("SELECT COUNT(*) FROM catalog_sources WHERE owner_name='AI-SMOKE-UID库'").pluck().get()), 0, '被拒绝的请求不能新建来源');
  result = await aiCall('delete_everything', {});
  assert.equal(result.response.status, 400, '未知工具应被拒绝');
  assert.equal(result.data.error?.code, 'UNKNOWN_TOOL');

  // 跨库自然键：另一成本库不能通过 upsert 挪走已有条目。
  // 历史导入的条目可能带其他供应商名称，因此直接落一条属于厂商甲、供应商写“厂商乙”的旧条目。
  result = await aiCall('create_source', { kind: 'cost', owner_name: 'AI-SMOKE-厂商乙', dry_run: false });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  const aiOtherCostSourceId = result.data.data.source.id;
  const aiLegacyDb = new Database(databasePath);
  aiLegacyDb.prepare(`INSERT INTO catalog_cost_items(id,source_id,active,item_no,category,name,specification,unit,supplier_name,cost_unit,min_quantity,remark,source_file,source_sheet,source_type,raw_data,created_at)
    VALUES(?,?,1,'1',?,?,?,?,'AI-SMOKE-厂商乙',?,'','','','','supplier_cost','{}',?)`)
    .run('ai-smoke-cross-source', aiCostSourceId, 'AI-SMOKE-跨库类', 'AI-SMOKE-跨库条目', 'AI-SMOKE-跨库规格', '项', 100, new Date().toISOString());
  aiLegacyDb.close();
  result = await aiCall('upsert_items', { source_id: aiOtherCostSourceId, dry_run: false, rows: [{ category: 'AI-SMOKE-跨库类', name: 'AI-SMOKE-跨库条目', specification: 'AI-SMOKE-跨库规格', unit: '项', cost_unit: '99.00' }] });
  assert.equal(result.response.status, 409, '其他资料库不能覆盖既有条目的自然键');
  assert.equal(result.data.error?.code, 'CROSS_SOURCE_CONFLICT');
  assert.equal(result.data.error?.path, 'arguments.rows[0]');
  const aiCrossItem = readDb((db) => db.prepare("SELECT source_id,cost_unit FROM catalog_cost_items WHERE id='ai-smoke-cross-source'").get());
  assert.equal(aiCrossItem?.source_id, aiCostSourceId, '条目仍应属于原资料库');
  assert.equal(aiCrossItem?.cost_unit, 100, '原条目金额不应被覆盖');

  // 报价库：写入金额为元、客户强制取资料库名称，search 返回统一价格和限价字段。
  result = await aiCall('create_source', { kind: 'quote', owner_name: 'AI-SMOKE-客户甲', dry_run: false });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  const aiQuoteSourceId = result.data.data.source.id;
  result = await aiCall('upsert_items', { source_id: aiQuoteSourceId, dry_run: false, rows: [{ category: 'AI-SMOKE-报价类', name: 'AI-SMOKE-报价项', unit: '项', price_incl_tax: '2468.00', max_quote_unit: '3000.00', estimated_quantity: 'AI-SMOKE-数量', project_name: 'AI-SMOKE-项目' }] });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.rows[0].price_incl_tax, '2468.00');
  result = await aiCall('search_items', { kind: 'quote', source_id: aiQuoteSourceId, q: 'AI-SMOKE-报价项' });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.items[0].price_incl_tax, '2468.00', '报价统一价格不应放大 100 倍');
  assert.equal(result.data.data.items[0].max_quote_unit, '3000.00');
  assert.equal(result.data.data.items[0].customer_name, 'AI-SMOKE-客户甲');
  result = await aiCall('search_items', { kind: 'cost', source_id: aiOtherCostSourceId, q: 'AI-SMOKE-喷画' });
  assert.equal(result.data.data.items.length, 0, '其他资料库搜索不到不属于自己的条目');
  result = await aiCall('list_sources', { kind: 'cost', q: 'AI-SMOKE-厂商' });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.ok(result.data.data.items.every((item) => item.owner_name.startsWith('AI-SMOKE-厂商')), '来源搜索应按名称过滤');
  assert.ok(result.data.data.items.some((item) => item.owner_name === 'AI-SMOKE-厂商甲'), '来源搜索应包含已写入的成本库');
  assert.ok(result.data.data.items.some((item) => item.owner_name === 'AI-SMOKE-厂商乙'), '来源搜索应包含新建的成本库');

  // 部门即身份：员工所在部门决定身份与权限；历史“管理人员”身份已并入老板。
  const identityDb = new Database(databasePath);
  const seededAt = new Date().toISOString();
  const insertEmployee = identityDb.prepare('INSERT OR REPLACE INTO employees(catsco_uid,username,display_name,department,role,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
  insertEmployee.run(1001, 'test1001', '王商务', '商务', 'business', 1, seededAt, seededAt);
  insertEmployee.run(1002, 'test1002', '李老板', '老板', 'owner', 1, seededAt, seededAt);
  insertEmployee.run(1003, 'test1003', '赵设计', '设计', 'designer', 1, seededAt, seededAt);
  insertEmployee.run(1004, 'test1004', '钱财务', '财务', 'finance', 1, seededAt, seededAt);
  insertEmployee.run(1005, 'test1005', '孙执行', '执行', 'executor', 1, seededAt, seededAt);
  insertEmployee.run(1006, 'test1006', '周执行', '执行', 'executor', 1, seededAt, seededAt);
  insertEmployee.run(1007, 'test1007', '吴商务', '商务', 'business', 1, seededAt, seededAt);
  identityDb.close();

  result = await request('/api/reimbursements', { method: 'POST', json: { item: '商务审核测试', amount: '6.00', advance_date: '2026-09-19' } });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  const businessReviewId = result.data.data.id;

  // 商务：可看全部订单、维护资料库，但不能管理员工、执行公司或审核报销。
  await withIdentityServer(1001, async (base) => {
    let result = await requestOn(base, '/api/orders');
    assert.equal(result.response.status, 200, '商务可查看订单列表');
    result = await requestOn(base, '/api/reimbursements?scope=review');
    assert.equal(result.response.status, 403, '商务未配置为审核人时不能访问审核队列');
    const own = await requestOn(base, '/api/reimbursements', { method: 'POST', json: { item: '商务自报', amount: '5.00', advance_date: '2026-09-19' } });
    assert.equal(own.response.status, 201, JSON.stringify(own.data));
    const ownId = own.data.data.id;
    const mine = await requestOn(base, '/api/reimbursements?scope=mine');
    assert.ok(mine.data.data.some((item) => item.id === ownId), '我的报销应包含本人记录');
    result = await requestOn(base, '/api/employees');
    assert.equal(result.response.status, 403, '商务不能访问员工列表');
    result = await requestOn(base, '/api/employees', { method: 'PATCH', json: { uid: 1001, display_name: '王商务', department: '财务' } });
    assert.equal(result.response.status, 403, '商务不能调整自己的部门或身份');
    result = await requestOn(base, '/api/employees', { method: 'PATCH', json: { uid: 1001, display_name: '王商务改名', department: '商务' } });
    assert.equal(result.response.status, 403, '商务没有维护员工资料的权限');
    result = await requestOn(base, '/api/execution-companies');
    assert.equal(result.response.status, 403, '商务不能管理执行公司');
    const businessSource = await requestOn(base, '/api/catalog/sources', { method: 'POST', json: { kind: 'cost', owner_name: '商务资料库', source_file: 'business-check.csv' } });
    assert.equal(businessSource.response.status, 201, '商务可新增报价成本库');
    result = await requestOn(base, '/api/reimbursements?scope=history');
    assert.equal(result.response.status, 403, '商务不能查看全部历史报销');
  });

  // 老板：可管理员工、执行公司和报销审核；但不能修改自己的部门，也不能再授予老板身份。
  await withIdentityServer(1002, async (base) => {
    let result = await requestOn(base, '/api/reimbursements?scope=review');
    assert.equal(result.response.status, 200, '老板可访问报销审核队列');
    assert.ok(result.data.data.some((item) => item.id === businessReviewId), '老板应看到待一级审核报销');
    assert.ok(result.data.data.every((item) => ['待一级审核', '待三级审核'].includes(item.reimbursement_status)), '老板只处理一级和三级节点');
    result = await requestOn(base, '/api/employees');
    assert.equal(result.response.status, 200, '老板可访问员工列表');
    result = await requestOn(base, '/api/employees', { method: 'PATCH', json: { uid: 1002, display_name: '李老板', department: '商务' } });
    assert.equal(result.response.status, 403, '老板不能修改自己的部门或身份');
    result = await requestOn(base, '/api/employees', { method: 'PATCH', json: { uid: 1002, display_name: '李老板改名', department: '老板' } });
    assert.equal(result.response.status, 200, '老板可维护自己的姓名');
    result = await requestOn(base, '/api/employees', { method: 'PATCH', json: { uid: 1001, display_name: '王商务', department: '老板' } });
    assert.equal(result.response.status, 403, '老板不能授予老板身份');
    result = await requestOn(base, '/api/employees', { method: 'PATCH', json: { uid: 1001, display_name: '王商务', department: '财务' } });
    assert.equal(result.response.status, 200, '老板可调整下级部门');
    assert.equal(result.data.data.role, 'finance', '身份随部门自动变为财务');
    result = await requestOn(base, '/api/employees', { method: 'PATCH', json: { uid: 1001, display_name: '王商务', department: '商务' } });
    assert.equal(result.response.status, 200, '老板可把员工调回商务');
    assert.equal(result.data.data.role, 'business', '身份随部门自动变回商务');
    result = await requestOn(base, '/api/employees', { method: 'PATCH', json: { uid: 1003, display_name: '赵设计', department: '执行' } });
    assert.equal(result.response.status, 200, '老板可跨部门调整员工');
    assert.equal(result.data.data.role, 'executor', '设计调到执行后身份变为执行');
    result = await requestOn(base, '/api/employees', { method: 'PATCH', json: { uid: 1003, display_name: '赵设计', department: '设计' } });
    assert.equal(result.response.status, 200, '老板可把员工调回设计');
    assert.equal(result.data.data.role, 'designer');
    result = await requestOn(base, '/api/employees', { method: 'DELETE', json: { uid: 1005 } });
    assert.equal(result.response.status, 200, '老板可删除下级员工');
    const ownerSource = await requestOn(base, '/api/catalog/sources', { method: 'POST', json: { kind: 'cost', owner_name: '老板资料库', source_file: 'owner-check.csv' } });
    assert.equal(ownerSource.response.status, 201, '老板可新增报价成本库');
  });

  // 执行公司管理：仅系统管理员、老板与执行可维护。
  await withIdentityServer(1002, async (base) => {
    let result = await requestOn(base, '/api/execution-companies');
    assert.equal(result.response.status, 200, '老板可查看执行公司');
    assert.ok(result.data.data.length >= 3, '默认执行公司应已初始化');
    result = await requestOn(base, '/api/execution-companies', { method: 'POST', json: { name: '老板新增执行公司' } });
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
    const companyId = result.data.data.id;
    result = await requestOn(base, '/api/execution-companies', { method: 'POST', json: { name: '老板新增执行公司' } });
    assert.equal(result.response.status, 400, '重复的执行公司应被拒绝');
    result = await requestOn(base, '/api/execution-companies', { method: 'PATCH', json: { id: companyId, name: '老板改名执行公司' } });
    assert.equal(result.response.status, 200, '老板可重命名执行公司');
    assert.equal(result.data.data.name, '老板改名执行公司');
    const ownerPage = await requestOn(base, '/employees');
    assert.equal(ownerPage.response.status, 200, '老板可访问员工/执行公司管理页');
    assert.match(Buffer.from(ownerPage.data).toString(), /执行公司/, '页面应包含执行公司管理区');
    result = await requestOn(base, '/api/execution-companies', { method: 'DELETE', json: { id: companyId } });
    assert.equal(result.response.status, 200, '老板可删除执行公司');
    result = await requestOn(base, '/api/execution-companies');
    assert.ok(!result.data.data.some((item) => item.id === companyId), '删除后不再返回该执行公司');
  });

  await withIdentityServer(1006, async (base) => {
    let result = await requestOn(base, '/api/execution-companies');
    assert.equal(result.response.status, 200, '执行可查看执行公司');
    result = await requestOn(base, '/api/execution-companies', { method: 'POST', json: { name: '执行新增公司' } });
    assert.equal(result.response.status, 201, '执行可新增执行公司');
    const createdCompanyId = result.data.data.id;
    const executorPage = await requestOn(base, '/employees');
    assert.equal(executorPage.response.status, 200, '执行可访问执行公司管理页');
    result = await requestOn(base, '/api/employees');
    assert.equal(result.response.status, 403, '执行仍不能访问员工列表接口');
    result = await requestOn(base, '/api/execution-companies', { method: 'DELETE', json: { id: createdCompanyId } });
    assert.equal(result.response.status, 200, '执行可删除执行公司');
  });

  await withIdentityServer(1001, async (base) => {
    let result = await requestOn(base, '/api/execution-companies');
    assert.equal(result.response.status, 403, '商务不能查看执行公司管理接口');
    result = await requestOn(base, '/api/execution-companies', { method: 'POST', json: { name: '商务越权公司' } });
    assert.equal(result.response.status, 403, '商务不能新增执行公司');
  });

  // 报价成本库：执行与可见权限对齐，可见即可维护（见 commit 06166c9）。
  await withIdentityServer(1006, async (base) => {
    let result = await requestOn(base, '/api/catalog');
    assert.equal(result.response.status, 200, '执行可请求资料库接口');
    assert.ok(result.data.data.quote.length + result.data.data.cost.length > 0, '执行应能看到报价成本库');
    result = await requestOn(base, '/api/catalog/sources');
    assert.ok(result.data.data.length > 0, '执行应能看到报价成本库来源');
    result = await requestOn(base, '/api/catalog/sources', { method: 'POST', json: { kind: 'cost', owner_name: '执行可维护库' } });
    assert.equal(result.response.status, 201, '执行应可新增报价成本库来源');
    result = await requestOn(base, '/api/reimbursements?scope=history');
    assert.equal(result.response.status, 403, '执行不能查看全部历史报销');
  });

  // 财务代传发票：审计记录财务本人，报销仍归属原员工。
  result = await request('/api/reimbursements', { method: 'POST', json: { item: '财务代传测试', amount: '10.00', advance_date: '2026-09-18' } });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  const financeUploadReimbursementId = result.data.data.id;
  await withIdentityServer(1004, async (base) => {
    const queue = await requestOn(base, '/api/reimbursements?scope=review');
    assert.ok(queue.data.data.every((item) => ['待二级审核', '待执行'].includes(item.reimbursement_status)), '财务只能看到待复核和待执行报销');
    const invoiceForm = new FormData();
    invoiceForm.append('file', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'finance-invoice.png');
    const uploaded = await requestOn(base, `/api/reimbursements/${financeUploadReimbursementId}/attachments`, { method: 'POST', body: invoiceForm });
    assert.equal(uploaded.response.status, 201, JSON.stringify(uploaded.data));
    const financeCatalog = await requestOn(base, '/api/catalog');
    assert.equal(financeCatalog.response.status, 200, '财务可请求资料库接口');
    assert.equal(financeCatalog.data.data.quote.length + financeCatalog.data.data.cost.length, 0, '财务不应看到报价成本库');
  });
  const auditDb = new Database(databasePath, { readonly: true });
  const financeUploadAudit = auditDb.prepare("SELECT actor_name,actor_uid FROM audit_logs WHERE entity_type='reimbursement' AND entity_id=? AND action IN ('upload_attachment','reupload_attachment') ORDER BY created_at DESC LIMIT 1").get(financeUploadReimbursementId);
  assert.equal(financeUploadAudit?.actor_uid, 1004, '财务代传发票应记录财务 UID');
  assert.equal(financeUploadAudit?.actor_name, '钱财务', '财务代传发票应记录财务姓名');
  assert.equal(auditDb.prepare('SELECT employee FROM reimbursements_simple WHERE id=?').pluck().get(financeUploadReimbursementId), 'catsco', '财务代传后报销仍属于原员工');
  auditDb.close();

  // 部门三级审批：按报销人部门配置审核人，只有当前节点的配置人员能看到和推进。
  result = await request('/api/department-approvers', { method: 'PATCH', json: {
    department: '设计',
    layers: { 1: [1006], 2: [1001], 3: [1002] }
  } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.deepEqual(result.data.data.approvers['设计']['1'].map((item) => item.employee_uid), [1006], '部门一级审核人应持久化');
  result = await request('/api/department-approvers', { method: 'PATCH', json: {
    department: '商务',
    layers: { 1: [1006], 2: [], 3: [] }
  } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  let departmentReimbursementId = '';
  let departmentAttachmentId = '';
  let departmentOrderAdvanceId = '';
  const legacyDepartmentReimbursementId = 'legacy-reimbursement-empty-department';
  const approverFixtureDb = new Database(databasePath);
  // 历史报销可能只有员工姓名/UID 而没有部门快照，审核人仍应看到并处理。
  approverFixtureDb.prepare("INSERT INTO reimbursements_simple(id,employee,item,amount,advance_date,order_id,invoice,note,status,created_at,employee_uid,department) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(legacyDepartmentReimbursementId, '赵设计', '历史部门缺失报销', 1200, '2026-09-20', null, '', '', 'pending_review', seededAt, 1003, '');
  approverFixtureDb.close();
  await withIdentityServer(1003, async (base) => {
    const created = await requestOn(base, '/api/reimbursements', { method: 'POST', json: { item: '部门审批测试', amount: '8.00', advance_date: '2026-09-20' } });
    assert.equal(created.response.status, 201, JSON.stringify(created.data));
    departmentReimbursementId = created.data.data.id;
    assert.equal(created.data.data.department, '设计', '报销应记录提交人部门快照');
    const queue = await requestOn(base, '/api/reimbursements?scope=review');
    assert.equal(queue.response.status, 403, '未配置为审核人的提交人不能访问审核队列');
    const attachmentForm = new FormData();
    attachmentForm.append('kind', 'proof');
    attachmentForm.append('file', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'department-proof.png');
    const uploaded = await requestOn(base, `/api/reimbursements/${departmentReimbursementId}/attachments`, { method: 'POST', body: attachmentForm });
    assert.equal(uploaded.response.status, 201, JSON.stringify(uploaded.data));
    departmentAttachmentId = uploaded.data.data.id;
  });
  await withIdentityServer(1007, async (base) => {
    // 订单个人垫付经过上传证明后，也应落入对应部门审核人的待办队列。
    const orderCreated = await requestOn(base, '/api/orders', { method: 'POST', json: { project_id: projectId, order_date: '2026-09-21', idempotency_key: 'smoke-department-order-advance', products: [{ name: '部门订单垫付', unit: '项', quantity: 1, unit_price: '10.00', cost_unit: '4.00', advance: true }], costs: [] } });
    assert.equal(orderCreated.response.status, 201, JSON.stringify(orderCreated.data));
    departmentOrderAdvanceId = orderCreated.data.data.advances[0].id;
    const orderProofForm = new FormData();
    orderProofForm.append('kind', 'proof');
    orderProofForm.append('file', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'department-order-proof.png');
    const orderProof = await requestOn(base, `/api/reimbursements/${departmentOrderAdvanceId}/attachments`, { method: 'POST', body: orderProofForm });
    assert.equal(orderProof.response.status, 201, JSON.stringify(orderProof.data));
    const orderInvoiceForm = new FormData();
    orderInvoiceForm.append('file', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'department-order-invoice.png');
    const orderInvoice = await requestOn(base, `/api/reimbursements/${departmentOrderAdvanceId}/attachments`, { method: 'POST', body: orderInvoiceForm });
    assert.equal(orderInvoice.response.status, 201, JSON.stringify(orderInvoice.data));
    const orderSubmitted = await requestOn(base, `/api/reimbursements/${departmentOrderAdvanceId}/submit-proof`, { method: 'POST', json: {} });
    assert.equal(orderSubmitted.response.status, 200, JSON.stringify(orderSubmitted.data));
    assert.equal(orderSubmitted.data.data.reimbursement_status, '待一级审核');
  });
  await withIdentityServer(1001, async (base) => {
    const list = await requestOn(base, `/api/reimbursements/${departmentReimbursementId}/attachments`);
    assert.equal(list.response.status, 200, '本部门任意层级审核人都应能查看附件列表');
    assert.ok(list.data.data.some((item) => item.id === departmentAttachmentId), '审核人应看到本部门报销附件');
    const file = await requestOn(base, `/api/reimbursement-attachments/${departmentAttachmentId}`);
    assert.equal(file.response.status, 200, '本部门任意层级审核人都应能下载附件');
  });
  await withIdentityServer(1007, async (base) => {
    const list = await requestOn(base, `/api/reimbursements/${departmentReimbursementId}/attachments`);
    assert.equal(list.response.status, 403, '非本部门审核人不能查看附件');
  });
  await withIdentityServer(1004, async (base) => {
    const queue = await requestOn(base, '/api/reimbursements?scope=review');
    assert.ok(!queue.data.data.some((item) => item.id === departmentReimbursementId), '未配置的财务不能处理该部门一级审核');
  });
  await withIdentityServer(1006, async (base) => {
    const queue = await requestOn(base, '/api/reimbursements?scope=review');
    const row = queue.data.data.find((item) => item.id === departmentReimbursementId);
    assert.ok(row, '配置的一级审核人应看到待办');
    assert.equal(row.reimbursement_status, '待一级审核');
    assert.equal(row.can_act, true);
    assert.ok(row.current_approvers.some((approver) => approver.uid === 1006), '待办应显示当前审核人');
    assert.deepEqual(row.current_approvers.map((approver) => approver.name), ['周执行'], '当前审核人应显示部门实际配置的姓名');
    assert.equal(row.using_default_approvers, false, '已配置部门审核人时不应标记为默认审核人');
    const orderAdvanceRow = queue.data.data.find((item) => item.id === departmentOrderAdvanceId);
    assert.ok(orderAdvanceRow, '订单个人垫付提交证明后应出现在对应部门审核人的待办中');
    assert.equal(orderAdvanceRow.can_act, true);
    assert.equal(orderAdvanceRow.department, '商务');
    assert.equal(orderAdvanceRow.advance_item, '部门订单垫付', '订单垫付待办应展示报销内容');
    assert.deepEqual(orderAdvanceRow.current_approvers.map((approver) => approver.name), ['周执行']);
    const legacyRow = queue.data.data.find((item) => item.id === legacyDepartmentReimbursementId);
    assert.ok(legacyRow, '部门快照缺失的历史报销也应按员工部门进入审核队列');
    assert.equal(legacyRow.can_act, true);
    assert.equal(legacyRow.advance_item, '历史部门缺失报销', '审核页面应能看到需要处理的报销内容');
    assert.deepEqual(legacyRow.current_approvers.map((approver) => approver.name), ['周执行']);
    const legacyAttachments = await requestOn(base, `/api/reimbursements/${legacyDepartmentReimbursementId}/attachments`);
    assert.equal(legacyAttachments.response.status, 200, '部门审核人应能查看历史报销内容附件');
    const reviewPage = await requestOn(base, '/reimbursements/review');
    assert.equal(reviewPage.response.status, 200, '配置审核人应能打开报销审核页面');
    assert.match(Buffer.from(reviewPage.data).toString('utf8'), /历史部门缺失报销/, '报销审核页面应展示需要本人处理的报销内容');
    const approved = await requestOn(base, '/api/reimbursements/batch', { method: 'POST', json: { ids: [departmentReimbursementId], status: '待二级审核' } });
    assert.equal(approved.response.status, 200, JSON.stringify(approved.data));
  });
  await withIdentityServer(1001, async (base) => {
    const approved = await requestOn(base, '/api/reimbursements/batch', { method: 'POST', json: { ids: [departmentReimbursementId], status: '待三级审核' } });
    assert.equal(approved.response.status, 200, JSON.stringify(approved.data));
  });
  await withIdentityServer(1002, async (base) => {
    const approved = await requestOn(base, '/api/reimbursements/batch', { method: 'POST', json: { ids: [departmentReimbursementId], status: '待执行' } });
    assert.equal(approved.response.status, 200, JSON.stringify(approved.data));
    const row = approved.data.data.find((item) => item.id === departmentReimbursementId);
    assert.ok(row.voucher_no, '三级审核通过后应自动生成单据');
  });
  result = await request('/api/department-approvers', { method: 'PATCH', json: { department: '设计', layers: { 1: [], 2: [], 3: [] } } });
  assert.equal(result.response.status, 200, '清空部门审核人后应回退默认角色');
  result = await request('/api/department-approvers', { method: 'PATCH', json: { department: '商务', layers: { 1: [], 2: [], 3: [] } } });
  assert.equal(result.response.status, 200, '清空商务审核人后应回退默认角色');

  // 固定管理员名单新增 406：可直接进入管理员页面和员工管理接口。
  await withIdentityServer(406, async (base) => {
    const employees = await requestOn(base, '/api/employees');
    assert.equal(employees.response.status, 200, 'UID 406 应拥有固定管理员权限');
    const adminPage = await requestOn(base, '/admin');
    assert.equal(adminPage.response.status, 200, 'UID 406 应能访问系统管理员页面');
    const createReserved = await requestOn(base, '/api/employees', { method: 'POST', json: { uid: 406, username: 'fake406', department: '财务' } });
    assert.equal(createReserved.response.status, 400, '固定管理员 406 不能被普通员工档案占用');
  });

  // 订单参与者不能修改结款状态，也不能使用资料库导入预览等管理能力。
  result = await request('/api/orders', { method: 'POST', json: { project_id: projectId, order_date: '2026-09-17', designer: '赵执行', designer_uid: 1003, created_by: 'catsco', idempotency_key: 'smoke-participant-1', products: [{ name: '参与者测试产品', unit: '项', quantity: 1, unit_price: '10.00' }], costs: [], advances: [] } });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  const participantOrderId = result.data.data.id;

  await withIdentityServer(1003, async (base) => {
    let result = await requestOn(base, '/api/employees');
    assert.equal(result.response.status, 403, '普通员工不能访问员工管理接口');
    const mine = await requestOn(base, '/api/reimbursements?scope=mine');
    const fallbackRow = mine.data.data.find((item) => item.id === legacyDepartmentReimbursementId);
    assert.equal(fallbackRow.using_default_approvers, true, '部门未配置审核人时才回退默认审核人');
    assert.deepEqual(fallbackRow.current_approvers.map((approver) => approver.name), ['系统管理员', '老板'], '回退时应显示默认审核内容');
    result = await requestOn(base, '/api/reimbursements?scope=review');
    assert.equal(result.response.status, 403, '普通员工不能访问报销审核队列');
    const employeePage = await requestOn(base, '/orders');
    assert.doesNotMatch(Buffer.from(employeePage.data).toString(), /aria-label="报销审核"/, '员工不应看到报销审核导航');
    const employeeReviewPage = await requestOn(base, '/reimbursements/review');
    assert.equal(employeeReviewPage.response.status, 303, '员工直接访问报销审核应跳转');
    const previewForm = new FormData();
    previewForm.append('mode', 'preview');
    previewForm.append('file', new Blob(['name,unit,cost_unit\nprint,sqm,10.50'], { type: 'text/csv' }), 'cost.csv');
    result = await requestOn(base, '/api/catalog/import', { method: 'POST', body: previewForm });
    assert.equal(result.response.status, 403, '普通员工不能使用资料库导入预览');
    result = await requestOn(base, `/api/orders/${participantOrderId}`, { method: 'PATCH', json: { designer_uid: 1003, designer: '赵执行', payment_status: '已结款', products: [{ name: '参与者测试产品', unit: '项', quantity: 1, unit_price: '10.00' }], costs: [], advances: [] } });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    result = await requestOn(base, '/api/orders');
    const participantOrder = result.data.data.find((order) => order.id === participantOrderId);
    assert.equal(participantOrder.payment_status, '未结款', '订单参与者不能把订单改为已结款');
    result = await requestOn(base, `/api/orders/${participantOrderId}/complete`, { method: 'POST', body: new FormData() });
    assert.equal(result.response.status, 400, '设计师未上传设计图不能完成订单');
    const designForm = new FormData();
    designForm.append('files', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'design.png');
    result = await requestOn(base, `/api/orders/${participantOrderId}/complete`, { method: 'POST', body: designForm });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.data.status, '已完成', '设计师上传设计图后可完成订单');
    result = await requestOn(base, `/api/orders/${participantOrderId}/attachments`);
    assert.ok(result.data.data.some((item) => item.attachment_kind === 'design' && item.file_name === 'design.png'), '设计图应以 design 附件保存');
  });

  // 网页 AI 路由已下线：待开通浏览器身份也只能得到 410。
  await withIdentityServer(1099, async (base) => {
    assertWebAiOffline(await requestOn(base, '/api/ai/me'), '待开通身份不能通过网页读取 AI 身份信息');
    assertWebAiOffline(await requestOn(base, '/api/ai/catalog'), '待开通身份不能通过网页获取 AI 工具清单');
    assertWebAiOffline(
      await requestOn(base, '/api/ai/catalog', { method: 'POST', json: { tool: 'search_items', arguments: { kind: 'cost', q: 'AI-SMOKE' } } }),
      '待开通身份不能通过网页调用 AI 小工具'
    );
  }, '/api/employees', [403]);

  await withAnonymousServer(async (base) => {
    assertWebAiOffline(await requestOn(base, '/api/ai/me'), '未登录不能通过网页读取 AI 身份信息');
    assertWebAiOffline(await requestOn(base, '/api/ai/catalog'), '未登录不能通过网页获取 AI 工具清单');
    assertWebAiOffline(
      await requestOn(base, '/api/ai/catalog', { method: 'POST', json: { tool: 'create_source', arguments: { kind: 'cost', owner_name: 'AI-SMOKE-未登录库' } } }),
      '未登录不能通过网页调用 AI 小工具'
    );
  });

  console.log('Smoke test passed: public workbench, catalog import/copy, creator snapshots, order totals, personal advances, independent attachments, order-linked reimbursements, reimbursement filters/state machine, voucher idempotency, aligned exports, employee management authorization, execution company management, local entry identity and catalog tools preview/money/conflict handling, failure-closed web AI routes, audit and v18/v20/v21/v23/v27 migrations.');
} finally {
  server.kill('SIGTERM');
  if (localServer) localServer.kill('SIGTERM');
  await new Promise((resolve) => { server.once('exit', resolve); setTimeout(resolve, 1000); });
  if (localServer) {
    const child = localServer;
    if (child.exitCode === null) await new Promise((resolve) => { child.once('exit', resolve); setTimeout(resolve, 2000); });
  }
  rmSync(directory, { recursive: true, force: true });
}
