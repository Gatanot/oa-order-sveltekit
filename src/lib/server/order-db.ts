import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const databasePath = resolve(process.env.DATABASE_PATH || './data/oa.db');
let instance: Database.Database | undefined;

const now = () => new Date().toISOString();
export const uuid = () => randomUUID();

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
  if (version?.value !== '3') {
    db.exec(`
      DROP TABLE IF EXISTS orders_simple;
      DROP TABLE IF EXISTS catalog_items;
      DROP TABLE IF EXISTS projects_simple;
      DROP TABLE IF EXISTS customers_simple;
      CREATE TABLE customers_simple(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, contact TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
      CREATE TABLE projects_simple(id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, name TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '进行中', created_at TEXT NOT NULL, UNIQUE(customer_id, name), FOREIGN KEY(customer_id) REFERENCES customers_simple(id) ON DELETE CASCADE);
      CREATE TABLE catalog_items(id TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '项', quote_unit INTEGER NOT NULL DEFAULT 0, cost_unit INTEGER NOT NULL DEFAULT 0, customer_name TEXT NOT NULL DEFAULT '', project_name TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, UNIQUE(category, name, customer_name, project_name));
      CREATE TABLE orders_simple(id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL, project_id TEXT NOT NULL, catalog_id TEXT, service_name TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 1, unit TEXT NOT NULL DEFAULT '项', quote_amount INTEGER NOT NULL DEFAULT 0, cost_amount INTEGER NOT NULL DEFAULT 0, order_date TEXT NOT NULL, created_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT '待处理', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, is_extra INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(customer_id) REFERENCES customers_simple(id), FOREIGN KEY(project_id) REFERENCES projects_simple(id), FOREIGN KEY(catalog_id) REFERENCES catalog_items(id));
      CREATE INDEX idx_simple_orders_date ON orders_simple(order_date DESC);
      CREATE INDEX idx_simple_orders_customer ON orders_simple(customer_id, project_id);
      CREATE TABLE IF NOT EXISTS schema_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      DELETE FROM schema_meta WHERE key='order_app_version';
      INSERT INTO schema_meta(key,value) VALUES('order_app_version','3');
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
  const insert = db.prepare('INSERT INTO catalog_items VALUES(?,?,?,?,?,?,?,?,?,1,?)');
  for (const item of items) insert.run(uuid(), ...item, '', '', created);
}

export function getOrderDb() {
  if (!instance) {
    mkdirSync(dirname(databasePath), { recursive: true });
    instance = new Database(databasePath);
    instance.pragma('foreign_keys = ON');
    instance.pragma('journal_mode = WAL');
    instance.transaction(() => { migrate(instance!); seed(instance!); })();
    // Keep the small order-desk schema backwards compatible with existing databases.
    const fields = instance.prepare('PRAGMA table_info(orders_simple)').all() as Array<{ name: string }>;
    if (!fields.some((field) => field.name === 'is_extra')) instance.exec("ALTER TABLE orders_simple ADD COLUMN is_extra INTEGER NOT NULL DEFAULT 0");
  }
  return instance;
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

export function listOrders() {
  return getOrderDb().prepare(`SELECT o.*, c.name AS customer_name, p.name AS project_name, p.owner AS project_owner, ci.category AS catalog_category FROM orders_simple o JOIN customers_simple c ON c.id=o.customer_id JOIN projects_simple p ON p.id=o.project_id LEFT JOIN catalog_items ci ON ci.id=o.catalog_id ORDER BY o.order_date DESC,o.created_at DESC`).all();
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
  const serviceName = String(data.service_name || '').trim();
  if (!serviceName) throw new Error('请填写订单内容');
  const quantity = Number(data.quantity || 1);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('数量必须大于 0');
  const id = uuid();
  const created = now();
  const date = String(data.order_date || created.slice(0, 10));
  const code = `ORD-${date.replaceAll('-', '')}-${id.slice(0, 6).toUpperCase()}`;
  db.prepare('INSERT INTO orders_simple(id,code,customer_id,project_id,catalog_id,service_name,quantity,unit,quote_amount,cost_amount,order_date,created_by,status,note,created_at,is_extra) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, code, project.customer_id, projectId, data.catalog_id ? String(data.catalog_id) : null, serviceName, quantity, String(data.unit || '项'), moneyToCents(data.quote_amount), moneyToCents(data.cost_amount), date, String(data.created_by || '当前用户'), String(data.status || '待处理'), String(data.note || '').trim(), created, data.is_extra ? 1 : 0);
  return db.prepare('SELECT * FROM orders_simple WHERE id=?').get(id);
}

export function importCatalog(rows: Array<Record<string, unknown>>) {
  const db = getOrderDb();
  const insert = db.prepare(`INSERT INTO catalog_items(id,category,name,unit,quote_unit,cost_unit,customer_name,project_name,active,created_at) VALUES(?,?,?,?,?,?,?, ?,1,?) ON CONFLICT(category,name,customer_name,project_name) DO UPDATE SET unit=excluded.unit,quote_unit=excluded.quote_unit,cost_unit=excluded.cost_unit,active=1`);
  return db.transaction(() => {
    let count = 0;
    for (const row of rows) {
      const name = String(row.name || row['名称'] || row['服务名称'] || '').trim();
      if (!name) continue;
      insert.run(uuid(), String(row.category || row['分类'] || '').trim(), name, String(row.unit || row['单位'] || '项'), moneyToCents(row.quote_unit ?? row['报价'] ?? row['报价单价'] ?? 0), moneyToCents(row.cost_unit ?? row['成本'] ?? row['成本单价'] ?? 0), String(row.customer_name || row['客户'] || row['公司'] || row['企业'] || '').trim(), String(row.project_name || row['项目'] || row['项目名称'] || '').trim(), now());
      count++;
    }
    return count;
  })();
}
