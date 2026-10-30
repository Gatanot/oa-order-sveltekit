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
  for (let index = 0; index < 80; index++) {
    // 进程已退出时立即失败并带上日志，避免迁移/启动错误只表现为 8 秒超时。
    if (child.exitCode !== null) throw new Error(`服务器已退出（code ${child.exitCode}）\n${readLogs()}`);
    let response;
    try { response = await fetch(`${targetOrigin}${probePath}`); } catch { /* 端口未就绪，重试 */ }
    // 部分身份（待开通/未登录）本就无法拿到 2xx，按预期状态码判断是否已可响应。
    if (response && (readyStatuses ? readyStatuses.includes(response.status) : response.ok)) return;
    // 服务已能响应但返回非预期 5xx，说明迁移/初始化失败，立即失败而不是空等 8 秒。
    if (response && !readyStatuses && response.status >= 500) throw new Error(`服务器启动失败（HTTP ${response.status}）\n${readLogs()}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`服务器启动超时\n${readLogs()}`);
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
  legacy.exec(`
    CREATE TABLE IF NOT EXISTS catalog_items(id TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '项', quote_unit INTEGER NOT NULL DEFAULT 0, cost_unit INTEGER NOT NULL DEFAULT 0, customer_name TEXT NOT NULL DEFAULT '', project_name TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, source_file TEXT NOT NULL DEFAULT '', source_sheet TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL DEFAULT 'manual', item_no TEXT NOT NULL DEFAULT '', specification TEXT NOT NULL DEFAULT '', estimated_quantity TEXT NOT NULL DEFAULT '', max_quote_unit INTEGER NOT NULL DEFAULT 0, supplier_remark TEXT NOT NULL DEFAULT '', raw_data TEXT NOT NULL DEFAULT '{}', source_id TEXT, UNIQUE(category,name,customer_name,project_name,specification,estimated_quantity));
  `);
}

async function withMigratedFixture(name, legacyVersion, prepare, assertions) {
  const path = join(directory, name);
  const source = new Database(databasePath, { readonly: true });
  await source.backup(path);
  source.close();
  const legacy = new Database(path);
  prepare(legacy);
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

  result = await request('/api/projects', { method: 'POST', json: { customer: '测试客户', name: '测试项目', owner: '项目负责人' } });
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

  const createPayload = { project_id: projectId, order_date: '2026-09-16', delivery_date: '2026-09-20', designer: '设计师甲', created_by: '填写人甲', idempotency_key: 'smoke-order-1', products: [{ name: '测试产品', unit: '项', quantity: 2, unit_price: '12.34', specification: '测试要求', remark: '行备注甲' }], costs: [{ name: '制作成本', vendor: '测试厂商', unit: '项', quantity: 2, unit_price: '3.21' }] };
  result = await request('/api/orders', { method: 'POST', json: createPayload });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.data.created_by, 'catsco', '录入人必须取自可信的登录身份，而非客户端提交值');
  assert.equal(result.data.data.quote_amount, 2468);
  assert.equal(result.data.data.cost_amount, 642);
  assert.equal(result.data.data.status, '已提交', '新订单默认状态应为已提交');
  assert.equal((result.data.data.advances || []).length, 0, '订单录入不再直接创建报销，需在报销页面关联订单');
  assert.equal(result.data.data.products[0].remark, '行备注甲', '订单项行备注应随产品保存并返回');
  const orderId = result.data.data.id;
  result = await request('/api/orders', { method: 'POST', json: createPayload });
  assert.equal(result.data.data.id, orderId, '重复提交必须返回原订单');

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
  assert.deepEqual(exportRows[6].slice(0, 8), ['序号', '产品名称', '单位', '数量', '规格和技术要求', '含税单价(元）', '小计（元）', '备注']);
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
  assert.ok(result.data.data.every((item) => item.reimbursement_status === '已提交待审核'), '管理员只应看到待审核节点');
  await setAdminWorkflowRole('manager');
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
  assert.equal(result.data.data.find((item) => item.id === reimbursementId).reimbursement_status, '已提交待审核', '补传发票后应回到管理人审核');
  result = await request('/api/reimbursements/batch', { method: 'POST', json: { ids: [reimbursementId], status: '已确认待执行' } });
  assert.notEqual(result.response.status, 200, '不允许跳过审核、复核和确认');
  await request('/admin?/clearExtraIdentity', { method: 'POST', body: new FormData() });
  result = await request('/api/reimbursements/batch', { method: 'POST', json: { ids: [reimbursementId], status: '已审核待复核' } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  for (const target of ['已复核待确认', '已打回']) {
    for (const batch of [false, true]) {
      result = await request(batch ? '/api/reimbursements/batch' : `/api/reimbursements/${reimbursementId}`, {
        method: batch ? 'POST' : 'PATCH', json: { ...(batch ? { ids: [reimbursementId] } : {}), status: target, reject_reason: '越权测试' },
      });
      assert.equal(result.response.status, 403, '管理员不能复核或打回财务节点，单条与批量均应拦截');
    }
  }
  await setAdminWorkflowRole('finance');
  result = await request('/api/reimbursements/batch', { method: 'POST', json: { ids: [reimbursementId], status: '已复核待确认' } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  result = await request('/api/reimbursements/batch', { method: 'POST', json: { ids: [reimbursementId], status: '已确认待执行' } });
  assert.equal(result.response.status, 403, '财务不能代替老板确认');
  await request('/admin?/clearExtraIdentity', { method: 'POST', body: new FormData() });
  result = await request(`/api/reimbursements/${reimbursementId}`, { method: 'PATCH', json: { status: '已确认待执行' } });
  assert.equal(result.response.status, 403, '管理员不能代替老板确认');
  await setAdminWorkflowRole('owner');
  result = await request('/api/reimbursements/batch', { method: 'POST', json: { ids: [reimbursementId], status: '已确认待执行' } });
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
  assert.equal(db.prepare("SELECT value FROM schema_meta WHERE key='order_app_version'").pluck().get(), '27');
  assert.equal(db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('catalog_quote_items','catalog_cost_items')").pluck().get(), 2, 'v27 应创建报价库/成本库分表');
  assert.equal(db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='catalog_items'").pluck().get(), 0, 'v27 应移除旧的 catalog_items');
  assert.equal(db.prepare("SELECT COUNT(*) FROM pragma_table_info('orders_simple') WHERE name='catalog_id'").pluck().get(), 0, 'v27 应移除 orders_simple.catalog_id');
  assert.ok(db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='catalog_cost_items'").pluck().get(), '成本库分表应存在');
  assert.ok(db.prepare("SELECT COUNT(*) FROM pragma_table_info('catalog_quote_items') WHERE name='price_incl_tax'").pluck().get(), '报价库应含税单价字段');
  assert.ok(db.prepare("SELECT COUNT(*) FROM pragma_table_info('catalog_quote_items') WHERE name='price_excl_tax'").pluck().get(), '报价库应含不含税单价字段');
  assert.ok(db.prepare("SELECT COUNT(*) FROM pragma_table_info('catalog_cost_items') WHERE name='cost_unit'").pluck().get(), '成本库应含成本单价字段');
  assert.ok(db.prepare("SELECT COUNT(*) FROM pragma_table_info('audit_logs') WHERE name='actor_uid'").pluck().get(), '审计表应包含操作者 UID');
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
    assert.equal(migrated.prepare("SELECT value FROM schema_meta WHERE key='order_app_version'").pluck().get(), '27');
    assert.ok(migrated.prepare("SELECT COUNT(*) FROM pragma_table_info('audit_logs') WHERE name='actor_uid'").pluck().get(), 'v23 数据库迁移后应补齐审计 actor_uid');
    assert.equal(migrated.prepare('SELECT COUNT(*) FROM orders_simple').pluck().get(), 1, 'v23 数据库重启后应保留订单');
    assert.equal(migrated.prepare('SELECT status FROM orders_simple LIMIT 1').pluck().get(), '已提交', 'v26 迁移应将历史订单状态归并为已提交');
    assert.ok(migrated.prepare("SELECT COUNT(*) FROM pragma_table_info('order_products') WHERE name='remark'").pluck().get(), '迁移后订单项应补齐行备注字段');
  });

  // 已在 v27 的库（上一版程序建的库）不会重跑 v27 重建，行备注只能靠幂等 ALTER 补齐。
  await withMigratedFixture('oa-v27.db', '27', (legacy) => {
    legacy.exec('ALTER TABLE order_products DROP COLUMN remark');
  }, (migrated) => {
    assert.equal(migrated.prepare("SELECT value FROM schema_meta WHERE key='order_app_version'").pluck().get(), '27');
    assert.ok(migrated.prepare("SELECT COUNT(*) FROM pragma_table_info('order_products') WHERE name='remark'").pluck().get(), 'v27 数据库重启应通过 ALTER 补齐行备注列');
    assert.equal(migrated.prepare('SELECT COUNT(*) FROM order_products').pluck().get(), 1, '补列不应丢失订单项');
    assert.equal(migrated.prepare('SELECT remark FROM order_products LIMIT 1').pluck().get(), '', '补列后历史行备注应为空字符串');
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
    assert.equal(migrated.prepare("SELECT value FROM schema_meta WHERE key='order_app_version'").pluck().get(), '27');
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
    assert.equal(migrated.prepare("SELECT value FROM schema_meta WHERE key='order_app_version'").pluck().get(), '27');
    assert.ok(migrated.prepare("SELECT COUNT(*) FROM pragma_table_info('orders_simple') WHERE name='planner'").pluck().get(), 'v20 数据库应补齐策划人字段');
    assert.ok(migrated.prepare("SELECT COUNT(*) FROM pragma_table_info('orders_simple') WHERE name='execution_company'").pluck().get(), 'v20 数据库应补齐执行公司字段');
    assert.equal(migrated.prepare('SELECT COUNT(*) FROM orders_simple').pluck().get(), 1, 'v20 迁移不应丢失订单');
    assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  });

  await withMigratedFixture('oa-v21.db', '21', (legacy) => {
    restoreLegacyCatalog(legacy);
    legacy.exec('ALTER TABLE orders_simple DROP COLUMN execution_company;');
  }, (migrated) => {
    assert.equal(migrated.prepare("SELECT value FROM schema_meta WHERE key='order_app_version'").pluck().get(), '27');
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
  const aiCostRows = [{ category: 'AI-SMOKE-成本类', name: 'AI-SMOKE-喷画', specification: 'AI-SMOKE-规格', unit: 'sqm', cost_unit: '12.34', cost_unit_excl_tax: '10.92', tax_rate: '13%' }];
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
  assert.equal(readDb((db) => db.prepare("SELECT cost_unit,cost_unit_excl_tax,supplier_name FROM catalog_cost_items WHERE source_id=? AND name='AI-SMOKE-喷画'").get(aiCostSourceId).cost_unit), 1234, '库内应以分存储 12.34 元');
  result = await aiCall('search_items', { kind: 'cost', source_id: aiCostSourceId, q: 'AI-SMOKE-喷画' });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.money_unit, 'yuan');
  assert.equal(result.data.data.items.length, 1);
  assert.equal(result.data.data.items[0].cost_unit, '12.34', '搜索返回的金额不应放大 100 倍');
  assert.equal(result.data.data.items[0].cost_unit_excl_tax, '10.92');
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
  assert.equal(result.response.status, 400, '缺少含税单价应被拒绝');
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
  aiLegacyDb.prepare(`INSERT INTO catalog_cost_items(id,source_id,active,item_no,category,name,specification,unit,supplier_name,cost_unit,cost_unit_excl_tax,tax_rate,min_quantity,remark,source_file,source_sheet,source_type,raw_data,created_at)
    VALUES(?,?,1,'1',?,?,?,?,'AI-SMOKE-厂商乙',?,0,'','','','','','supplier_cost','{}',?)`)
    .run('ai-smoke-cross-source', aiCostSourceId, 'AI-SMOKE-跨库类', 'AI-SMOKE-跨库条目', 'AI-SMOKE-跨库规格', '项', 100, new Date().toISOString());
  aiLegacyDb.close();
  result = await aiCall('upsert_items', { source_id: aiOtherCostSourceId, dry_run: false, rows: [{ category: 'AI-SMOKE-跨库类', name: 'AI-SMOKE-跨库条目', specification: 'AI-SMOKE-跨库规格', unit: '项', cost_unit: '99.00' }] });
  assert.equal(result.response.status, 409, '其他资料库不能覆盖既有条目的自然键');
  assert.equal(result.data.error?.code, 'CROSS_SOURCE_CONFLICT');
  assert.equal(result.data.error?.path, 'arguments.rows[0]');
  const aiCrossItem = readDb((db) => db.prepare("SELECT source_id,cost_unit FROM catalog_cost_items WHERE id='ai-smoke-cross-source'").get());
  assert.equal(aiCrossItem?.source_id, aiCostSourceId, '条目仍应属于原资料库');
  assert.equal(aiCrossItem?.cost_unit, 100, '原条目金额不应被覆盖');

  // 报价库：写入金额为元、客户强制取资料库名称，search 返回含税/不含税/限价字段。
  result = await aiCall('create_source', { kind: 'quote', owner_name: 'AI-SMOKE-客户甲', dry_run: false });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  const aiQuoteSourceId = result.data.data.source.id;
  result = await aiCall('upsert_items', { source_id: aiQuoteSourceId, dry_run: false, rows: [{ category: 'AI-SMOKE-报价类', name: 'AI-SMOKE-报价项', unit: '项', price_incl_tax: '2468.00', price_excl_tax: '2184.07', max_quote_unit: '3000.00', estimated_quantity: 'AI-SMOKE-数量', project_name: 'AI-SMOKE-项目' }] });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.rows[0].price_incl_tax, '2468.00');
  result = await aiCall('search_items', { kind: 'quote', source_id: aiQuoteSourceId, q: 'AI-SMOKE-报价项' });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.items[0].price_incl_tax, '2468.00', '报价含税单价不应放大 100 倍');
  assert.equal(result.data.data.items[0].max_quote_unit, '3000.00');
  assert.equal(result.data.data.items[0].customer_name, 'AI-SMOKE-客户甲');
  result = await aiCall('search_items', { kind: 'cost', source_id: aiOtherCostSourceId, q: 'AI-SMOKE-喷画' });
  assert.equal(result.data.data.items.length, 0, '其他资料库搜索不到不属于自己的条目');
  result = await aiCall('list_sources', { kind: 'cost', q: 'AI-SMOKE-厂商' });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.ok(result.data.data.items.every((item) => item.owner_name.startsWith('AI-SMOKE-厂商')), '来源搜索应按名称过滤');
  assert.ok(result.data.data.items.some((item) => item.owner_name === 'AI-SMOKE-厂商甲'), '来源搜索应包含已写入的成本库');
  assert.ok(result.data.data.items.some((item) => item.owner_name === 'AI-SMOKE-厂商乙'), '来源搜索应包含新建的成本库');

  // 员工管理授权：管理人员与老板都不能改自己的身份/启用状态，也不能管理同级或更高级别。
  const identityDb = new Database(databasePath);
  const seededAt = new Date().toISOString();
  const insertEmployee = identityDb.prepare('INSERT OR REPLACE INTO employees(catsco_uid,username,display_name,department,role,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
  insertEmployee.run(1001, 'test1001', '王管理', '商务', 'manager', 1, seededAt, seededAt);
  insertEmployee.run(1002, 'test1002', '李老板', '商务', 'owner', 1, seededAt, seededAt);
  insertEmployee.run(1003, 'test1003', '赵执行', '执行', 'executor', 1, seededAt, seededAt);
  insertEmployee.run(1004, 'test1004', '钱财务', '内务', 'finance', 1, seededAt, seededAt);
  insertEmployee.run(1005, 'test1005', '孙执行', '执行', 'executor', 1, seededAt, seededAt);
  insertEmployee.run(1006, 'test1006', '周执行', '执行', 'executor', 1, seededAt, seededAt);
  identityDb.close();

  // 审核队列按角色裁剪，且不包含本人提交的报销；本人报销只在“我的报销”可见。
  result = await request('/api/reimbursements', { method: 'POST', json: { item: '管理人审核测试', amount: '6.00', advance_date: '2026-09-19' } });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  const managerReviewId = result.data.data.id;

  await withIdentityServer(1001, async (base) => {
    let result = await requestOn(base, '/api/reimbursements?scope=review');
    assert.ok(result.data.data.some((item) => item.id === managerReviewId), '管理人应看到他人待审核报销');
    assert.ok(result.data.data.every((item) => item.reimbursement_status === '已提交待审核'), '管理人只能看到待审核报销');
    const own = await requestOn(base, '/api/reimbursements', { method: 'POST', json: { item: '管理人自报', amount: '5.00', advance_date: '2026-09-19' } });
    assert.equal(own.response.status, 201, JSON.stringify(own.data));
    const ownId = own.data.data.id;
    const mine = await requestOn(base, '/api/reimbursements?scope=mine');
    assert.ok(mine.data.data.some((item) => item.id === ownId), '我的报销应包含本人记录');
    const reviewQueue = await requestOn(base, '/api/reimbursements?scope=review');
    assert.ok(!reviewQueue.data.data.some((item) => item.id === ownId), '审核队列不应包含本人报销');
    const selfReview = await requestOn(base, `/api/reimbursements/${ownId}`, { method: 'PATCH', json: { status: '已审核待复核' } });
    assert.equal(selfReview.response.status, 403, '审核者不能处理本人提交的报销');
    result = await requestOn(base, '/api/employees');
    assert.equal(result.response.status, 200, '管理人员可访问员工列表');
    result = await requestOn(base, '/api/employees', { method: 'PATCH', json: { uid: 1001, display_name: '王管理', department: '商务', role: 'owner', active: true } });
    assert.equal(result.response.status, 403, '管理人员不能把自己提升为老板');
    result = await requestOn(base, '/api/employees', { method: 'PATCH', json: { uid: 1001, display_name: '王管理', department: '商务', role: 'manager', active: false } });
    assert.equal(result.response.status, 403, '管理人员不能停用自己');
    result = await requestOn(base, '/api/employees', { method: 'PATCH', json: { uid: 1001, display_name: '王管理改名', department: '商务', role: 'manager', active: true } });
    assert.equal(result.response.status, 200, '管理人员可维护自己的姓名和部门');
    result = await requestOn(base, '/api/employees', { method: 'PATCH', json: { uid: 1002, display_name: '李老板', department: '商务', role: 'executor', active: true } });
    assert.equal(result.response.status, 403, '管理人员不能降级老板');
    result = await requestOn(base, '/api/employees', { method: 'DELETE', json: { uid: 1002 } });
    assert.equal(result.response.status, 403, '管理人员不能删除老板');
    result = await requestOn(base, '/api/employees', { method: 'PATCH', json: { uid: 1003, display_name: '赵执行', department: '执行', role: 'manager', active: true } });
    assert.equal(result.response.status, 403, '管理人员不能授予管理身份');
    result = await requestOn(base, '/api/employees', { method: 'PATCH', json: { uid: 1003, display_name: '赵执行', department: '设计', role: 'designer', active: true } });
    assert.equal(result.response.status, 200, '管理人员可管理下级员工');
    result = await requestOn(base, '/api/employees', { method: 'DELETE', json: { uid: 1005 } });
    assert.equal(result.response.status, 200, '管理人员可删除下级员工');
    const managedSource = await requestOn(base, '/api/catalog/sources', { method: 'POST', json: { kind: 'cost', owner_name: '管理人员资料库', source_file: 'manager-check.csv' } });
    assert.equal(managedSource.response.status, 201, '管理人员可新增报价成本库');
  });

  // 执行公司管理：仅系统管理员、老板与执行可维护，管理人员无权。
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
    assert.equal(result.response.status, 403, '管理人员不能查看执行公司管理接口');
    result = await requestOn(base, '/api/execution-companies', { method: 'POST', json: { name: '管理人员越权公司' } });
    assert.equal(result.response.status, 403, '管理人员不能新增执行公司');
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

  await withIdentityServer(1002, async (base) => {
    let result = await requestOn(base, '/api/reimbursements?scope=review');
    assert.ok(result.data.data.every((item) => item.reimbursement_status === '已复核待确认'), '老板只能看到待确认报销');
    result = await requestOn(base, '/api/employees', { method: 'PATCH', json: { uid: 1002, display_name: '李老板', department: '商务', role: 'manager', active: true } });
    assert.equal(result.response.status, 403, '老板不能改变自己的身份');
    result = await requestOn(base, '/api/employees', { method: 'PATCH', json: { uid: 1002, display_name: '李老板', department: '商务', role: 'owner', active: false } });
    assert.equal(result.response.status, 403, '老板不能停用自己');
    result = await requestOn(base, '/api/employees', { method: 'PATCH', json: { uid: 1001, display_name: '王管理', department: '商务', role: 'manager', active: true } });
    assert.equal(result.response.status, 200, '老板可管理管理人员');
    result = await requestOn(base, '/api/employees', { method: 'PATCH', json: { uid: 1004, display_name: '钱财务', department: '内务', role: 'finance', active: true } });
    assert.equal(result.response.status, 200, '老板可管理财务人员');
  });

  // 财务代传发票：审计记录财务本人，报销仍归属原员工。
  result = await request('/api/reimbursements', { method: 'POST', json: { item: '财务代传测试', amount: '10.00', advance_date: '2026-09-18' } });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  const financeUploadReimbursementId = result.data.data.id;
  await withIdentityServer(1004, async (base) => {
    const queue = await requestOn(base, '/api/reimbursements?scope=review');
    assert.ok(queue.data.data.every((item) => ['已审核待复核', '已确认待执行'].includes(item.reimbursement_status)), '财务只能看到待复核和待执行报销');
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

  // 订单参与者不能修改结款状态，也不能使用资料库导入预览等管理能力。
  result = await request('/api/orders', { method: 'POST', json: { project_id: projectId, order_date: '2026-09-17', designer: '赵执行', designer_uid: 1003, created_by: 'catsco', idempotency_key: 'smoke-participant-1', products: [{ name: '参与者测试产品', unit: '项', quantity: 1, unit_price: '10.00' }], costs: [], advances: [] } });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  const participantOrderId = result.data.data.id;

  await withIdentityServer(1003, async (base) => {
    let result = await requestOn(base, '/api/employees');
    assert.equal(result.response.status, 403, '普通员工不能访问员工管理接口');
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

  console.log('Smoke test passed: public workbench, catalog import/copy, creator snapshots, order totals, independent attachments, order-linked reimbursements, reimbursement filters/state machine, voucher idempotency, aligned exports, employee management authorization, execution company management, local entry identity and catalog tools preview/money/conflict handling, failure-closed web AI routes, audit and v18/v20/v21/v23/v27 migrations.');
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
