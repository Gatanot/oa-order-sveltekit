import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve, join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import * as XLSX from 'xlsx';

export const databasePath = resolve(process.env.DATABASE_PATH || './data/oa.db');
export const attachmentDir = resolve(dirname(databasePath), 'attachments');
let instance: Database.Database | undefined;

const now = () => new Date().toISOString();
export const uuid = () => randomUUID();

/** 把乘积四舍五入到分，避免浮点误差（如 454×17.4 = 7899.599999999999）。 */
function lineTotalYuan(item: Record<string, unknown>): number {
  return Math.round(Number(item.quantity || 0) * Number(item.unit_price || 0) * 100) / 100;
}

/** 过滤掉关键名称为空的行（用户点了“添加”但未填写），再检查是否至少有一行有效。 */
function sanitizeLines(lines: Array<Record<string, unknown>>, nameKey: string): Array<Record<string, unknown>> {
  return lines.filter((item) => text(item[nameKey]));
}

/** 明细为空时的回退解析：空/缺省金额视为 0，非法值仍然报错。 */
function optionalMoneyToCents(value: unknown): number {
  if (value === '' || value === null || value === undefined) return 0;
  return moneyToCents(value);
}

export function moneyToCents(value: unknown): number {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') throw new Error('金额格式不正确');
  const raw = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new Error('金额格式不正确');
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount > Number.MAX_SAFE_INTEGER / 100) throw new Error('金额格式不正确');
  return Math.round(amount * 100);
}

function migrate(db: Database.Database) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const version = db.prepare("SELECT value FROM schema_meta WHERE key='order_app_version'").get() as { value: string } | undefined;
  if (version?.value !== '5') {
    db.exec(`
      DROP TABLE IF EXISTS order_attachments;
      DROP TABLE IF EXISTS orders_simple;
      DROP TABLE IF EXISTS catalog_items;
      DROP TABLE IF EXISTS projects_simple;
      DROP TABLE IF EXISTS customers_simple;
      CREATE TABLE customers_simple(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, contact TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
      CREATE TABLE projects_simple(id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, name TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '进行中', created_at TEXT NOT NULL, UNIQUE(customer_id, name), FOREIGN KEY(customer_id) REFERENCES customers_simple(id) ON DELETE CASCADE);
      CREATE TABLE catalog_items(id TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '项', quote_unit INTEGER NOT NULL DEFAULT 0, cost_unit INTEGER NOT NULL DEFAULT 0, customer_name TEXT NOT NULL DEFAULT '', project_name TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, source_file TEXT NOT NULL DEFAULT '', source_sheet TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL DEFAULT 'manual', item_no TEXT NOT NULL DEFAULT '', specification TEXT NOT NULL DEFAULT '', estimated_quantity TEXT NOT NULL DEFAULT '', max_quote_unit INTEGER NOT NULL DEFAULT 0, supplier_remark TEXT NOT NULL DEFAULT '', raw_data TEXT NOT NULL DEFAULT '{}', UNIQUE(category, name, customer_name, project_name));
      CREATE TABLE orders_simple(id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL, project_id TEXT NOT NULL, catalog_id TEXT, service_name TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 1, unit TEXT NOT NULL DEFAULT '项', quote_amount INTEGER NOT NULL DEFAULT 0, cost_amount INTEGER NOT NULL DEFAULT 0, order_date TEXT NOT NULL, created_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT '待处理', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, specification TEXT NOT NULL DEFAULT '', is_extra INTEGER NOT NULL DEFAULT 0, reimbursement_status TEXT NOT NULL DEFAULT '无需报销' CHECK(reimbursement_status IN ('无需报销','待核验','待报销','已报销')), reimbursed_by TEXT NOT NULL DEFAULT '', reimbursed_at TEXT, FOREIGN KEY(customer_id) REFERENCES customers_simple(id), FOREIGN KEY(project_id) REFERENCES projects_simple(id), FOREIGN KEY(catalog_id) REFERENCES catalog_items(id));
      CREATE TABLE order_attachments(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT '', file_size INTEGER NOT NULL DEFAULT 0, storage_path TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, FOREIGN KEY(order_id) REFERENCES orders_simple(id) ON DELETE CASCADE);
      CREATE INDEX idx_simple_orders_date ON orders_simple(order_date DESC);
      CREATE INDEX idx_simple_orders_customer ON orders_simple(customer_id, project_id);
      CREATE TABLE IF NOT EXISTS schema_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      DELETE FROM schema_meta WHERE key='order_app_version';
      INSERT INTO schema_meta(key,value) VALUES('order_app_version','5');
    `);
  }
}

function seed(db: Database.Database) {
  const count = (db.prepare('SELECT COUNT(*) AS count FROM customers_simple').get() as { count: number }).count;
  if (count) return;
  const created = now();
  const customerId = uuid();
  db.prepare('INSERT INTO customers_simple VALUES(?,?,?,?)').run(customerId, '示例客户有限公司', '采购联系人：王女士', created);
  const projectId = uuid();
  db.prepare('INSERT INTO projects_simple VALUES(?,?,?,?,?,?)').run(projectId, customerId, '年度活动物料项目', '李海明', '进行中', created);
  const items = [
    ['物料制作', '会议背板', '块', 2800, 1600],
    ['活动服务', '现场执行', '人天', 1200, 700],
    ['设计服务', '主视觉设计', '项', 3500, 1800]
  ];
  const insert = db.prepare('INSERT INTO catalog_items(id,category,name,unit,quote_unit,cost_unit,customer_name,project_name,active,created_at) VALUES(?,?,?,?,?,?,?, ?,1,?)');
  for (const item of items) insert.run(uuid(), ...item, '', '', created);
}

export function getOrderDb() {
  if (!instance) {
    mkdirSync(dirname(databasePath), { recursive: true });
    instance = new Database(databasePath);
    instance.pragma('foreign_keys = ON');
    instance.pragma('journal_mode = WAL');
    instance.transaction(() => { migrate(instance!); seed(instance!); })();
    // Keep existing databases compatible, while retaining every business field from the Excel sheets.
    const fields = instance.prepare('PRAGMA table_info(orders_simple)').all() as Array<{ name: string }>;
    if (!fields.some((field) => field.name === 'is_extra')) instance.exec("ALTER TABLE orders_simple ADD COLUMN is_extra INTEGER NOT NULL DEFAULT 0");
    const orderAdditions: Record<string, string> = {
      delivery_date: "TEXT NOT NULL DEFAULT ''", contact: "TEXT NOT NULL DEFAULT ''",
      payment_status: "TEXT NOT NULL DEFAULT '未结款'", products_json: "TEXT NOT NULL DEFAULT '[]'",
      costs_json: "TEXT NOT NULL DEFAULT '[]'", advances_json: "TEXT NOT NULL DEFAULT '[]'"
    };
    for (const [name, type] of Object.entries(orderAdditions)) if (!fields.some((field) => field.name === name)) instance.exec(`ALTER TABLE orders_simple ADD COLUMN ${name} ${type}`);
    const catalogFields = instance.prepare('PRAGMA table_info(catalog_items)').all() as Array<{ name: string }>;
    const additions: Record<string, string> = {
      source_file: "TEXT NOT NULL DEFAULT ''", source_sheet: "TEXT NOT NULL DEFAULT ''", source_type: "TEXT NOT NULL DEFAULT 'manual'",
      item_no: "TEXT NOT NULL DEFAULT ''", specification: "TEXT NOT NULL DEFAULT ''", estimated_quantity: "TEXT NOT NULL DEFAULT ''",
      max_quote_unit: 'INTEGER NOT NULL DEFAULT 0', supplier_remark: "TEXT NOT NULL DEFAULT ''", raw_data: "TEXT NOT NULL DEFAULT '{}'"
    };
    for (const [name, type] of Object.entries(additions)) if (!catalogFields.some((field) => field.name === name)) instance.exec(`ALTER TABLE catalog_items ADD COLUMN ${name} ${type}`);
    instance.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_source_row ON catalog_items(source_file, source_sheet, item_no, name, specification)');
    const attachmentFields = instance.prepare('PRAGMA table_info(order_attachments)').all() as Array<{ name: string }>;
    if (!attachmentFields.some((field) => field.name === 'storage_path')) instance.exec("ALTER TABLE order_attachments ADD COLUMN storage_path TEXT NOT NULL DEFAULT ''");
    importBundledExcel(instance);
  }
  return instance;
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function excelMoney(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(String(value).replace(/,/g, '').replace(/元/g, '').trim());
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}

/** Imports the supplied enterprise price books as-is. No row is discarded because it
 * does not fit the original order form: requirements, quantity tiers, source and
 * supplier notes are all retained in catalog_items.raw_data and typed columns. */
function importBundledExcel(db: Database.Database) {
  const dir = join(process.cwd(), 'excel');
  if (!existsSync(dir)) return;
  const files = ['【佛山广电集采价-AI测试版】2023年至2025年宣传广告活动资格标种类表报价表-广东省瑜鹏传媒科技有限公司(1).xls', '【供应商成本价-测试版】硕达2026年喷画结算价.xlsx'];
  const upsert = db.prepare(`INSERT INTO catalog_items(id,category,name,unit,quote_unit,cost_unit,customer_name,project_name,active,created_at,source_file,source_sheet,source_type,item_no,specification,estimated_quantity,max_quote_unit,supplier_remark,raw_data)
    VALUES(?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT DO UPDATE SET category=excluded.category,unit=excluded.unit,quote_unit=excluded.quote_unit,cost_unit=excluded.cost_unit,estimated_quantity=excluded.estimated_quantity,max_quote_unit=excluded.max_quote_unit,supplier_remark=excluded.supplier_remark,raw_data=excluded.raw_data,active=1,source_file=excluded.source_file,source_sheet=excluded.source_sheet,source_type=excluded.source_type,item_no=excluded.item_no,specification=excluded.specification`);
  const add = (row: Record<string, unknown>, meta: { file: string; sheet: string; type: string; no: string; category: string }) => {
    const name = text(row.name) || text(row.product_name);
    if (!name) return;
    upsert.run(uuid(), meta.category, name, text(row.unit) || '项', Number(row.quote_unit || 0), Number(row.cost_unit || 0), '', '', now(), meta.file, meta.sheet, meta.type, meta.no, text(row.specification), text(row.estimated_quantity), Number(row.max_quote_unit || 0), text(row.supplier_remark), JSON.stringify(row));
  };
  db.transaction(() => {
    for (const file of files) {
      const path = join(dir, file); if (!existsSync(path)) continue;
      const workbook = XLSX.read(readFileSync(path), { type: 'buffer' });
      for (const sheet of workbook.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], { header: 1, defval: '' });
        if (file.endsWith('.xls')) {
          let category = sheet, previousName = '';
          for (let i = 4; i < rows.length; i++) {
            const r = rows[i] || []; const no = text(r[0]);
            if (!no || !/^\d+$/.test(no)) { if (text(r[0])) category = text(r[0]).replace(/类$/, ''); continue; }
            const name = text(r[1]) || previousName; if (name) previousName = name;
            add({ name, unit: text(r[2]), estimated_quantity: r[3], specification: r[4], max_quote_unit: excelMoney(r[5]), quote_unit: excelMoney(r[6]) }, { file, sheet, type: 'enterprise_quote', no, category });
          }
        } else {
          let category = sheet, header = -1;
          for (let i = 0; i < rows.length; i++) {
            const first = text((rows[i] || [])[0]);
            if (first && (first.includes('材料名称') || first.includes('产品名称'))) { header = i; break; }
            if (first && !first.includes('硕达') && !first.includes('单位') && !first.includes('材料')) category = first;
          }
          if (header < 0) continue;
          let previousCategory = category;
          for (let i = header + 1; i < rows.length; i++) {
            const r = rows[i] || []; const name = text(r[0]);
            if (!name) { if (text(r[1])) previousCategory = text(r[1]); continue; }
            add({ name, unit: r[1], cost_unit: excelMoney(r[2]), supplier_remark: r[3] }, { file, sheet, type: 'supplier_cost', no: String(i + 1), category: previousCategory });
          }
        }
      }
    }
  })();
}

export function listCustomers() {
  return getOrderDb().prepare('SELECT * FROM customers_simple ORDER BY name').all();
}

export function listProjects(customerId?: string) {
  const db = getOrderDb();
  return customerId
    ? db.prepare('SELECT p.*, c.name AS customer_name FROM projects_simple p JOIN customers_simple c ON c.id=p.customer_id WHERE p.customer_id=? ORDER BY p.name').all(customerId)
    : db.prepare('SELECT p.*, c.name AS customer_name FROM projects_simple p JOIN customers_simple c ON c.id=p.customer_id ORDER BY c.name,p.name').all();
}

export function listCatalog() {
  return getOrderDb().prepare('SELECT * FROM catalog_items WHERE active=1 ORDER BY category,name').all();
}

function parseList(value: unknown): Array<Record<string, unknown>> {
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function hydrateOrder(row: Record<string, unknown>) {
  const products = parseList(row.products_json);
  const costs = parseList(row.costs_json);
  const advances = parseList(row.advances_json);
  // 旧版单产品订单没有 products_json，用主字段合成展示行；新版空产品行不再合成（可能只有成本/垫付）
  if (!products.length && !costs.length && !advances.length && row.service_name) products.push({ name: row.service_name, specification: row.specification || '', quantity: row.quantity, unit: row.unit, unit_price: Number(row.quote_amount || 0) / Math.max(Number(row.quantity || 1), 1) / 100, subtotal: Number(row.quote_amount || 0) / 100 });
  return { ...row, products, costs, advances };
}

export function listOrders() {
  const rows = getOrderDb().prepare(`SELECT o.*, c.name AS customer_name, c.contact AS customer_contact, p.name AS project_name, p.owner AS project_owner, ci.category AS catalog_category FROM orders_simple o JOIN customers_simple c ON c.id=o.customer_id JOIN projects_simple p ON p.id=o.project_id LEFT JOIN catalog_items ci ON ci.id=o.catalog_id ORDER BY o.order_date DESC,o.created_at DESC`).all() as Array<Record<string, unknown>>;
  return rows.map(hydrateOrder);
}

export interface CreateProjectInput {
  customer?: string;
  customer_id?: string;
  name: string;
  owner?: string;
}

export function createProject(data: CreateProjectInput) {
  const db = getOrderDb();
  return db.transaction(() => {
    let customerId = data.customer_id;
    if (!customerId) {
      const customer = String(data.customer || '').trim();
      if (!customer) throw new Error('请填写客户名称');
      const existing = db.prepare('SELECT id FROM customers_simple WHERE name=?').get(customer) as { id: string } | undefined;
      customerId = existing?.id || uuid();
      if (!existing) db.prepare('INSERT INTO customers_simple VALUES(?,?,?,?)').run(customerId, customer, '', now());
    }
    const name = String(data.name || '').trim();
    if (!name) throw new Error('请填写项目名称');
    const projectId = uuid();
    db.prepare('INSERT INTO projects_simple VALUES(?,?,?,?,?,?)').run(projectId, customerId, name, String(data.owner || '').trim(), '进行中', now());
    return db.prepare('SELECT p.*, c.name AS customer_name FROM projects_simple p JOIN customers_simple c ON c.id=p.customer_id WHERE p.id=?').get(projectId);
  })();
}

export function createOrder(data: Record<string, unknown>) {
  const db = getOrderDb();
  const projectId = String(data.project_id || '');
  const project = db.prepare('SELECT * FROM projects_simple WHERE id=?').get(projectId) as { id: string; customer_id: string } | undefined;
  if (!project) throw new Error('请选择项目');
  const products = sanitizeLines(Array.isArray(data.products) ? data.products as Array<Record<string, unknown>> : [], 'name');
  const costs = sanitizeLines(Array.isArray(data.costs) ? data.costs as Array<Record<string, unknown>> : [], 'name');
  const advances = sanitizeLines(Array.isArray(data.advances) ? data.advances as Array<Record<string, unknown>> : [], 'item');
  if (!products.length && !costs.length && !advances.length) throw new Error('请至少填写一项产品、固定成本或员工垫付');
  const primary = products[0] || costs[0] || advances[0];
  const serviceName = String(data.service_name || products.map((item) => text(item.name)).filter(Boolean).join('、') || costs.map((item) => text(item.name)).filter(Boolean).join('、') || advances.map((item) => text(item.item)).filter(Boolean).join('、') || primary.name || primary.item).trim();
  if (!serviceName) throw new Error('请填写订单内容');
  const quantity = Number(data.quantity || products[0]?.quantity || 1);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('数量必须大于 0');
  const id = uuid();
  const created = now();
  const date = String(data.order_date || created.slice(0, 10));
  const code = `ORD-${date.replaceAll('-', '')}-${id.slice(0, 6).toUpperCase()}`;
  const catalogId = data.catalog_id ? String(data.catalog_id) : null;
  const reimbursementStatus = advances.length || data.submit_reimbursement ? '待核验' : '无需报销';
  const quoteCents = products.length ? products.reduce((sum, item) => sum + moneyToCents(lineTotalYuan(item)), 0) : optionalMoneyToCents(data.quote_amount);
  const costCents = costs.length ? costs.reduce((sum, item) => sum + moneyToCents(lineTotalYuan(item)), 0) : optionalMoneyToCents(data.cost_amount);
  db.prepare('INSERT INTO orders_simple(id,code,customer_id,project_id,catalog_id,service_name,quantity,unit,quote_amount,cost_amount,order_date,created_by,status,note,created_at,specification,is_extra,reimbursement_status,delivery_date,contact,payment_status,products_json,costs_json,advances_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, code, project.customer_id, projectId, catalogId, serviceName, quantity, String(data.unit || products[0]?.unit || '项'), quoteCents, costCents, date, String(data.created_by || '当前用户'), String(data.status || '制作中'), String(data.note || '').trim(), created, text(data.specification || products[0]?.specification), data.is_extra ? 1 : 0, reimbursementStatus, text(data.delivery_date), text(data.contact), text(data.payment_status) || '未结款', JSON.stringify(products), JSON.stringify(costs), JSON.stringify(advances));
  return hydrateOrder(db.prepare('SELECT * FROM orders_simple WHERE id=?').get(id) as Record<string, unknown>);
}

export function updateOrder(id: string, data: Record<string, unknown>) {
  const db = getOrderDb();
  const existing = db.prepare('SELECT * FROM orders_simple WHERE id=?').get(id) as Record<string, unknown> | undefined;
  if (!existing) throw new Error('ORDER_NOT_FOUND');
  const products = Array.isArray(data.products) ? data.products as Array<Record<string, unknown>> : parseList(existing.products_json);
  const costs = Array.isArray(data.costs) ? data.costs as Array<Record<string, unknown>> : parseList(existing.costs_json);
  const advances = Array.isArray(data.advances) ? sanitizeLines(data.advances as Array<Record<string, unknown>>, 'item') : parseList(existing.advances_json);
  if (!products.length && !costs.length && !advances.length) throw new Error('请至少保留一项产品、固定成本或员工垫付');
  const quote = products.reduce((sum, item) => sum + moneyToCents(lineTotalYuan(item)), 0);
  const cost = costs.reduce((sum, item) => sum + moneyToCents(lineTotalYuan(item)), 0);
  const service = products.map((item) => text(item.name)).filter(Boolean).join('、') || costs.map((item) => text(item.name)).filter(Boolean).join('、') || advances.map((item) => text(item.item)).filter(Boolean).join('、') || text(data.service_name) || String(existing.service_name);
  const targetProject = text(data.project_id || existing.project_id);
  db.prepare(`UPDATE orders_simple SET project_id=?,customer_id=(SELECT customer_id FROM projects_simple WHERE id=?),service_name=?,quantity=?,unit=?,quote_amount=?,cost_amount=?,order_date=?,delivery_date=?,contact=?,created_by=?,status=?,payment_status=?,note=?,specification=?,products_json=?,costs_json=?,advances_json=?,reimbursement_status=? WHERE id=?`).run(targetProject, targetProject, service, Number(products[0]?.quantity || existing.quantity), text(products[0]?.unit || existing.unit), quote, cost, text(data.order_date || existing.order_date), text(data.delivery_date), text(data.contact), text(data.created_by || existing.created_by), text(data.status || existing.status), text(data.payment_status || existing.payment_status), text(data.note), text(products[0]?.specification || existing.specification), JSON.stringify(products), JSON.stringify(costs), JSON.stringify(advances), advances.length ? (text(data.reimbursement_status) || '待核验') : '无需报销', id);
  return hydrateOrder(db.prepare(`SELECT o.*,c.name customer_name,p.name project_name,p.owner project_owner FROM orders_simple o JOIN customers_simple c ON c.id=o.customer_id JOIN projects_simple p ON p.id=o.project_id WHERE o.id=?`).get(id) as Record<string, unknown>);
}

export function deleteOrder(id: string) {
  const db = getOrderDb();
  const files = db.prepare('SELECT storage_path FROM order_attachments WHERE order_id=?').all(id) as Array<{ storage_path: string }>;
  const result = db.prepare('DELETE FROM orders_simple WHERE id=?').run(id);
  if (!result.changes) throw new Error('ORDER_NOT_FOUND');
  for (const file of files) removeAttachmentFile(file.storage_path);
}

export function listReimbursementOrders(filters: Record<string, string> = {}) {
  const db = getOrderDb();
  const where = ["o.reimbursement_status <> '无需报销'"];
  const values: string[] = [];
  if (filters.project) { where.push('o.project_id=?'); values.push(filters.project); }
  if (filters.person) { where.push('o.created_by=?'); values.push(filters.person); }
  if (filters.from) { where.push('o.order_date>=?'); values.push(filters.from); }
  if (filters.to) { where.push('o.order_date<=?'); values.push(filters.to); }
  if (filters.status) { where.push('o.reimbursement_status=?'); values.push(filters.status); }
  return db.prepare(`SELECT o.*, c.name AS customer_name, p.name AS project_name, p.owner AS project_owner,
    (SELECT COUNT(*) FROM order_attachments a WHERE a.order_id=o.id) AS attachment_count
    FROM orders_simple o JOIN customers_simple c ON c.id=o.customer_id JOIN projects_simple p ON p.id=o.project_id
    WHERE ${where.join(' AND ')} ORDER BY o.order_date DESC,o.created_at DESC`).all(...values);
}

export function updateReimbursement(id: string, status: string, actor: string) {
  if (!['待核验', '待报销', '已报销'].includes(status)) throw new Error('INVALID_REIMBURSEMENT_STATUS');
  const db = getOrderDb();
  const updatedAt = status === '已报销' ? now() : null;
  const result = db.prepare('UPDATE orders_simple SET reimbursement_status=?,reimbursed_by=CASE WHEN ?=\'已报销\' THEN ? ELSE reimbursed_by END,reimbursed_at=CASE WHEN ?=\'已报销\' THEN ? ELSE reimbursed_at END WHERE id=? AND catalog_id IS NULL').run(status, status, actor, status, updatedAt, id);
  if (!result.changes) throw new Error('ORDER_NOT_FOUND');
  return db.prepare('SELECT * FROM orders_simple WHERE id=?').get(id);
}

export const maxAttachmentSize = 10 * 1024 * 1024;

/** 图片与 PDF 文件的魔数特征，用于确认上传内容真实可信。 */
function detectAttachmentMime(data: Buffer): string {
  if (data.length >= 5 && data.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (data.length >= 4 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 3 && data.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  if (data.length >= 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return '';
}

export function listOrderAttachments(orderId: string) {
  return getOrderDb().prepare('SELECT id,order_id,file_name,mime_type,file_size,created_at FROM order_attachments WHERE order_id=? ORDER BY created_at DESC').all(orderId);
}

export function getOrderAttachment(attachmentId: string) {
  return getOrderDb().prepare('SELECT id,order_id,file_name,mime_type,file_size,storage_path,created_at FROM order_attachments WHERE id=?').get(attachmentId);
}

export function readAttachmentFile(row: { storage_path: string }): Buffer {
  if (!row.storage_path) throw new Error('ATTACHMENT_FILE_MISSING');
  const path = resolve(attachmentDir, row.storage_path);
  if (!path.startsWith(attachmentDir + sep) || !existsSync(path)) throw new Error('ATTACHMENT_FILE_MISSING');
  return readFileSync(path);
}

function removeAttachmentFile(storagePath: string) {
  if (!storagePath) return;
  const path = resolve(attachmentDir, storagePath);
  if (!path.startsWith(attachmentDir + sep) || !existsSync(path)) return;
  try { unlinkSync(path); } catch { /* 忽略清理失败，不影响主流程 */ }
}

export function addOrderAttachment(orderId: string, file: { name: string; data: Buffer }) {
  const db = getOrderDb();
  const order = db.prepare('SELECT id FROM orders_simple WHERE id=? OR code=?').get(orderId, orderId) as { id: string } | undefined;
  if (!order) throw new Error('ORDER_NOT_FOUND');
  if (!file.data?.length) throw new Error('附件内容为空');
  if (file.data.length > maxAttachmentSize) throw new Error('单个附件不能超过 10MB');
  const mime = detectAttachmentMime(file.data);
  if (!mime) throw new Error('仅支持上传图片（PNG/JPG/GIF/WebP）或 PDF 文件');
  const id = uuid();
  const safeName = (file.name || '附件').replace(/[\\/:*?"<>|\r\n\t]+/g, '_').trim().slice(-120) || '附件';
  const extension = mime === 'application/pdf' ? '.pdf' : `.${mime.split('/')[1].replace('jpeg', 'jpg')}`;
  const storagePath = join(order.id, `${id}${extension}`);
  mkdirSync(join(attachmentDir, order.id), { recursive: true });
  writeFileSync(join(attachmentDir, storagePath), file.data);
  db.prepare('INSERT INTO order_attachments(id,order_id,file_name,mime_type,file_size,created_at,storage_path) VALUES(?,?,?,?,?,?,?)').run(id, order.id, safeName, mime, file.data.length, now(), storagePath);
  return db.prepare('SELECT id,order_id,file_name,mime_type,file_size,created_at FROM order_attachments WHERE id=?').get(id);
}

export function importCatalog(rows: Array<Record<string, unknown>>) {
  const db = getOrderDb();
  const insert = db.prepare(`INSERT INTO catalog_items(id,category,name,unit,quote_unit,cost_unit,customer_name,project_name,active,created_at,source_file,source_sheet,source_type,item_no,specification,estimated_quantity,max_quote_unit,supplier_remark,raw_data)
    VALUES(?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(category,name,customer_name,project_name) DO UPDATE SET unit=excluded.unit,quote_unit=excluded.quote_unit,cost_unit=excluded.cost_unit,active=1,specification=excluded.specification,estimated_quantity=excluded.estimated_quantity,max_quote_unit=excluded.max_quote_unit,supplier_remark=excluded.supplier_remark,raw_data=excluded.raw_data`);
  return db.transaction(() => {
    let count = 0;
    for (const row of rows) {
      const name = text(row.name || row['名称'] || row['服务名称'] || row['产品名称'] || row['材料名称']);
      if (!name) continue;
      const quote = row.quote_unit ?? row['报价'] ?? row['报价单价'] ?? row['含税投标单价报价'] ?? 0;
      const cost = row.cost_unit ?? row['成本'] ?? row['成本单价'] ?? row['含13%税单价(元）'] ?? 0;
      insert.run(uuid(), text(row.category || row['分类'] || ''), name, text(row.unit || row['单位'] || '项'), excelMoney(quote), excelMoney(cost), text(row.customer_name || row['客户'] || row['公司'] || row['企业'] || ''), text(row.project_name || row['项目'] || row['项目名称'] || ''), now(), text(row.source_file), text(row.source_sheet), 'upload', text(row.item_no || row['序号'] || count + 1), text(row.specification || row['规格和技术要求'] || row['备注'] || ''), text(row.estimated_quantity || row['预估数量'] || ''), excelMoney(row.max_quote_unit || row['含税最高单价限价'] || 0), text(row.supplier_remark || row['备注'] || ''), JSON.stringify(row));
      count++;
    }
    return count;
  })();
}
