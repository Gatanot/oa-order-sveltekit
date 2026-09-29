import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
const server = spawn(process.execPath, ['build'], { env: { ...process.env, DATABASE_PATH: databasePath, NODE_ENV: 'test', OA_TEST_AUTH_BYPASS: '1', PORT: String(port), ORIGIN: origin }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
server.stdout.on('data', (chunk) => { logs += chunk; });
server.stderr.on('data', (chunk) => { logs += chunk; });
let fixturePortOffset = 0;

async function waitForServer(targetOrigin = origin, readLogs = () => logs) {
  for (let index = 0; index < 80; index++) {
    try { if ((await fetch(`${targetOrigin}/orders`)).ok) return; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`服务器启动超时\n${readLogs()}`);
}

async function request(path, { json, ...options } = {}) {
  const headers = new Headers(options.headers);
  if (json !== undefined) headers.set('content-type', 'application/json');
  if (options.body instanceof FormData) headers.set('origin', origin);
  const response = await fetch(`${origin}${path}`, { ...options, headers, body: json === undefined ? options.body : JSON.stringify(json), redirect: 'manual' });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('json') ? await response.json() : await response.arrayBuffer();
  return { response, data };
}

/** 复制当前 v23 数据库为旧版本 fixture，启动一次服务触发迁移，再用只读连接断言结果。 */
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
    await waitForServer(fixtureOrigin, () => fixtureLogs);
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

async function requestOn(base, path, { json, ...options } = {}) {
  const headers = new Headers(options.headers);
  if (json !== undefined) headers.set('content-type', 'application/json');
  if (options.body instanceof FormData) headers.set('origin', base);
  const response = await fetch(`${base}${path}`, { ...options, headers, body: json === undefined ? options.body : JSON.stringify(json), redirect: 'manual' });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('json') ? await response.json() : await response.arrayBuffer();
  return { response, data };
}

/** 以指定员工 UID 启动一次服务，用于验证非管理员的员工管理授权。 */
async function withIdentityServer(uid, assertions) {
  const identityPort = port + 900 + fixturePortOffset++;
  const identityOrigin = `http://127.0.0.1:${identityPort}`;
  let identityLogs = '';
  const identityServer = spawn(process.execPath, ['build'], { env: { ...process.env, DATABASE_PATH: databasePath, NODE_ENV: 'test', OA_TEST_AUTH_BYPASS: '1', OA_TEST_UID: String(uid), PORT: String(identityPort), ORIGIN: identityOrigin }, stdio: ['ignore', 'pipe', 'pipe'] });
  identityServer.stdout.on('data', (chunk) => { identityLogs += chunk; });
  identityServer.stderr.on('data', (chunk) => { identityLogs += chunk; });
  try {
    await waitForServer(identityOrigin, () => identityLogs);
    await assertions(identityOrigin);
  } finally {
    identityServer.kill('SIGTERM');
  }
}

try {
  await waitForServer();
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
  assert.equal(result.response.status, 201, '财务身份可以维护资料库');
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
  assert.equal(result.data.data.filter((item) => item.source_id === copiedSourceId).length, 1, '沿用后的资料库应可直接用于录单');

  const createPayload = { project_id: projectId, order_date: '2026-09-16', delivery_date: '2026-09-20', designer: '设计师甲', created_by: '填写人甲', idempotency_key: 'smoke-order-1', products: [{ name: '测试产品', unit: '项', quantity: 2, unit_price: '12.34', specification: '测试要求' }], costs: [{ name: '制作成本', vendor: '测试厂商', unit: '项', quantity: 2, unit_price: '3.21' }], advances: [{ employee: '填写人甲', item: '', amount: 0, date: '2026-09-16' }, { employee: '垫付人乙', item: '打样费', amount: '8.50', date: '2026-09-16' }] };
  result = await request('/api/orders', { method: 'POST', json: createPayload });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.data.created_by, 'catsco', '录入人必须取自可信的登录身份，而非客户端提交值');
  assert.equal(result.data.data.quote_amount, 2468);
  assert.equal(result.data.data.cost_amount, 642);
  assert.equal(result.data.data.advances.length, 1, '空白垫付行不应创建报销记录');
  assert.equal(result.data.data.advances[0].employee, '垫付人乙', '每条垫付应保存独立员工姓名');
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

  result = await request(`/api/orders/${orderId}`, { method: 'PATCH', json: { project_id: projectId, order_date: '2026-09-16', delivery_date: '2026-09-21', designer: '设计师乙', created_by: '填写人乙', payment_status: '已结款', status: '已完成', products: [{ name: '测试产品', unit: '项', quantity: 1, unit_price: '20.00' }], costs: [], advances: [] } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.created_by, 'catsco');

  result = await request(`/api/orders/export?ids=${encodeURIComponent(orderId)}&mode=detail&columns=code,product_name,quote_amount&expand=false&total=true&actor=财务甲`);
  assert.equal(result.response.status, 200);
  let workbook = XLSX.read(Buffer.from(result.data), { type: 'buffer' });
  let exportRows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });
  assert.equal(exportRows.length, 3, '订单明细应包含表头、订单行和合计行');
  assert.equal(exportRows[2][0], '合计');
  result = await request(`/api/orders/export?ids=${encodeURIComponent(orderId)}&mode=settlement&followA=${encodeURIComponent('甲方联系人')}&followB=${encodeURIComponent('乙方跟进人')}&contactPhone=123456&actor=财务甲`);
  assert.equal(result.response.status, 200);
  const settlementBuffer = Buffer.from(result.data);
  workbook = XLSX.read(settlementBuffer, { type: 'buffer', cellStyles: true, cellFormula: true });
  const settlementSheet = workbook.Sheets[workbook.SheetNames[0]];
  const settlementXml = strFromU8(unzipSync(settlementBuffer)['xl/worksheets/sheet1.xml']);
  exportRows = XLSX.utils.sheet_to_json(settlementSheet, { header: 1, defval: '' });
  assert.equal(workbook.SheetNames[0], '结算', '结算单工作表名称应与模板一致');
  assert.deepEqual(exportRows[6].slice(0, 8), ['序号', '产品名称', '单位', '数量', '规格和技术要求', '含税单价(元）', '小计（元）', '备注']);
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
  result = await request('/api/reimbursements?status=未报销');
  assert.ok(result.data.data.some((item) => item.id === reimbursementId), '未报销筛选应包含待审核记录');
  result = await request(`/api/reimbursements/${reimbursementId}`, { method: 'PATCH', json: { status: '已打回', reject_reason: '请补充发票', actor: '财务甲' } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.reimbursement_status, '已打回');
  const invoice = new FormData();
  invoice.append('file', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'invoice.png');
  result = await request(`/api/reimbursements/${reimbursementId}/attachments`, { method: 'POST', body: invoice });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  result = await request('/api/reimbursements?person=catsco');
  assert.equal(result.data.data.find((item) => item.id === reimbursementId).reimbursement_status, '待审核', '补传发票后应回到待审核');
  result = await request('/api/reimbursements/batch', { method: 'POST', json: { ids: [reimbursementId], status: '待打款', actor: '财务甲' } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  const automaticVoucherNo = result.data.data[0].voucher_no;
  assert.ok(automaticVoucherNo, '审核通过进入待打款时应自动生成单据');
  result = await request('/api/reimbursements/batch', { method: 'POST', json: { ids: [reimbursementId], status: '已报销', actor: '财务甲' } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  result = await request('/api/reimbursements?status=未报销');
  assert.ok(!result.data.data.some((item) => item.id === reimbursementId), '未报销筛选不应包含已付款记录');
  result = await request(`/api/orders/${orderId}`,  { method: 'PATCH', json: { project_id: projectId, order_date: '2026-09-16', delivery_date: '2026-09-21', designer: '设计师乙', created_by: '填写人乙', payment_status: '已结款', status: '已完成', products: [{ name: '测试产品', unit: '项', quantity: 1, unit_price: '20.00' }], costs: [], advances: [] } });
  assert.equal(result.response.status, 400, '已进入报销流程的垫付不能通过订单接口删除');
  assert.match(result.data.error?.message || '', /不可删除或修改/);
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
  assert.equal(db.prepare("SELECT value FROM schema_meta WHERE key='order_app_version'").pluck().get(), '24');
  assert.ok(db.prepare("SELECT COUNT(*) FROM pragma_table_info('audit_logs') WHERE name='actor_uid'").pluck().get(), '审计表应包含操作者 UID');
  assert.ok(db.prepare('SELECT COUNT(*) FROM audit_logs WHERE actor_uid=826').pluck().get() >= 1, '审计应记录操作者 UID');
  assert.equal(db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='system_admin_identity'").pluck().get(), 1, '系统管理员额外身份应持久化保存');
  assert.equal(db.prepare('SELECT COUNT(*) FROM system_admin_identity').pluck().get(), 0, '清除额外身份后应回到系统管理员身份');
  assert.equal(db.prepare('SELECT COUNT(*) FROM orders_simple').pluck().get(), 1, '幂等键不能产生重复订单');
  assert.equal(db.prepare('SELECT created_by_uid FROM orders_simple LIMIT 1').pluck().get(), 826, '订单录入人应关联可信的 Catsco UID');
  assert.ok(db.prepare("SELECT COUNT(*) FROM pragma_table_info('orders_simple') WHERE name IN ('created_by_uid','designer_uid','planner_uid')").pluck().get() === 3, '订单应保存员工 UID 关联');
  assert.equal(db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('users','sessions')").pluck().get(), 0, '全新数据库不应创建登录或角色表');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.ok(db.prepare('SELECT COUNT(*) FROM audit_logs').pluck().get() >= 5);
  db.close();

  await withMigratedFixture('oa-v23.db', '23', () => {}, (migrated) => {
    assert.equal(migrated.prepare("SELECT value FROM schema_meta WHERE key='order_app_version'").pluck().get(), '24');
    assert.ok(migrated.prepare("SELECT COUNT(*) FROM pragma_table_info('audit_logs') WHERE name='actor_uid'").pluck().get(), 'v23 数据库迁移后应补齐审计 actor_uid');
    assert.equal(migrated.prepare('SELECT COUNT(*) FROM orders_simple').pluck().get(), 1, 'v23 数据库重启后应保留订单');
  });

  await withMigratedFixture('oa-v18.db', '18', (legacy) => {
    legacy.exec(`
      DROP INDEX IF EXISTS idx_orders_idempotency;
      ALTER TABLE orders_simple DROP COLUMN idempotency_key;
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
    assert.equal(migrated.prepare("SELECT value FROM schema_meta WHERE key='order_app_version'").pluck().get(), '24');
    assert.ok(migrated.prepare("SELECT COUNT(*) FROM pragma_table_info('orders_simple') WHERE name='idempotency_key'").pluck().get(), 'v18 数据库应补齐幂等字段');
    assert.equal(migrated.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('users','sessions')").pluck().get(), 0, '迁移后不应保留登录表');
    for (const [table, column] of [['orders_simple', 'created_by_user_id'], ['reimbursements_simple', 'employee_user_id'], ['reimbursements_simple', 'voucher_archived_by_user_id'], ['order_attachments', 'uploaded_by_user_id'], ['reimbursement_attachments', 'uploaded_by_user_id'], ['catalog_sources', 'maintained_by_user_id'], ['audit_logs', 'actor_user_id']]) {
      assert.equal(migrated.prepare(`SELECT COUNT(*) FROM pragma_table_info('${table}') WHERE name=?`).pluck().get(column), 0, `迁移后不应保留 ${table}.${column}`);
    }
    assert.equal(migrated.prepare('SELECT COUNT(*) FROM orders_simple').pluck().get(), 1, '迁移不应丢失订单');
    assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  });

  await withMigratedFixture('oa-v20.db', '20', (legacy) => {
    legacy.exec('ALTER TABLE orders_simple DROP COLUMN planner; ALTER TABLE orders_simple DROP COLUMN execution_company;');
  }, (migrated) => {
    assert.equal(migrated.prepare("SELECT value FROM schema_meta WHERE key='order_app_version'").pluck().get(), '24');
    assert.ok(migrated.prepare("SELECT COUNT(*) FROM pragma_table_info('orders_simple') WHERE name='planner'").pluck().get(), 'v20 数据库应补齐策划人字段');
    assert.ok(migrated.prepare("SELECT COUNT(*) FROM pragma_table_info('orders_simple') WHERE name='execution_company'").pluck().get(), 'v20 数据库应补齐执行公司字段');
    assert.equal(migrated.prepare('SELECT COUNT(*) FROM orders_simple').pluck().get(), 1, 'v20 迁移不应丢失订单');
    assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  });

  await withMigratedFixture('oa-v21.db', '21', (legacy) => {
    legacy.exec('ALTER TABLE orders_simple DROP COLUMN execution_company;');
  }, (migrated) => {
    assert.equal(migrated.prepare("SELECT value FROM schema_meta WHERE key='order_app_version'").pluck().get(), '24');
    assert.ok(migrated.prepare("SELECT COUNT(*) FROM pragma_table_info('orders_simple') WHERE name='execution_company'").pluck().get(), 'v21 数据库应补齐执行公司字段');
    assert.equal(migrated.prepare('SELECT COUNT(*) FROM orders_simple').pluck().get(), 1, 'v21 迁移不应丢失订单');
    assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  });

  // 员工管理授权：管理人员与老板都不能改自己的身份/启用状态，也不能管理同级或更高级别。
  const identityDb = new Database(databasePath);
  const seededAt = new Date().toISOString();
  const insertEmployee = identityDb.prepare('INSERT OR REPLACE INTO employees(catsco_uid,username,display_name,department,role,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
  insertEmployee.run(1001, 'test1001', '王管理', '商务', 'manager', 1, seededAt, seededAt);
  insertEmployee.run(1002, 'test1002', '李老板', '商务', 'owner', 1, seededAt, seededAt);
  insertEmployee.run(1003, 'test1003', '赵执行', '执行', 'executor', 1, seededAt, seededAt);
  insertEmployee.run(1004, 'test1004', '钱财务', '内务', 'finance', 1, seededAt, seededAt);
  insertEmployee.run(1005, 'test1005', '孙执行', '执行', 'executor', 1, seededAt, seededAt);
  identityDb.close();

  await withIdentityServer(1001, async (base) => {
    let result = await requestOn(base, '/api/employees');
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
  });

  await withIdentityServer(1002, async (base) => {
    let result = await requestOn(base, '/api/employees', { method: 'PATCH', json: { uid: 1002, display_name: '李老板', department: '商务', role: 'manager', active: true } });
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
    const invoiceForm = new FormData();
    invoiceForm.append('file', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'finance-invoice.png');
    const uploaded = await requestOn(base, `/api/reimbursements/${financeUploadReimbursementId}/attachments`, { method: 'POST', body: invoiceForm });
    assert.equal(uploaded.response.status, 201, JSON.stringify(uploaded.data));
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
  });

  console.log('Smoke test passed: public workbench, catalog import/copy, creator snapshots, order totals, independent attachments, immutable processed advances, reimbursement filters/state machine, voucher idempotency, aligned exports, employee management authorization, audit and v18/v20/v21/v23 migrations.');
} finally {
  server.kill('SIGTERM');
  await new Promise((resolve) => { server.once('exit', resolve); setTimeout(resolve, 1000); });
  rmSync(directory, { recursive: true, force: true });
}
