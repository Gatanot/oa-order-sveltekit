import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve, join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import * as XLSX from 'xlsx';
import XLSXStyle from 'xlsx-js-style';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  isAdminUid,
  departments,
  reimbursementNextCodeForLayer,
  reimbursementStatusCode,
  reimbursementStatusLabel,
  reimbursementStepForStatus,
  reimbursementWorkflow,
  type ReimbursementStatusCode
} from '$lib/permissions';
import { addDaysInBizTZ, todayInBizTZ } from '$lib/server/time';

export const databasePath = resolve(process.env.DATABASE_PATH || './data/oa.db');
export const attachmentDir = resolve(dirname(databasePath), 'attachments');
let instance: Database.Database | undefined;

const now = () => new Date().toISOString();
export const uuid = () => randomUUID();
type AuditInput = { actorName?: string; actorUid?: number | null; action: string; entityType: string; entityId?: string; fromValue?: string; toValue?: string; detail?: Record<string, unknown> };
function recordAudit(db: Database.Database, input: AuditInput) {
  db.prepare('INSERT INTO audit_logs(id,actor_name,actor_uid,action,entity_type,entity_id,from_value,to_value,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(uuid(), input.actorName || '', input.actorUid ?? null, input.action, input.entityType, input.entityId || '', input.fromValue || '', input.toValue || '', JSON.stringify(input.detail || {}), now());
}
export function addAuditLog(input: AuditInput) { recordAudit(getOrderDb(), input); }
function reimbursementVoucherNo(id: string, date: string): string {
  return `BX-${String(date || '').replaceAll('-', '')}-${String(id).replaceAll('-', '').slice(0, 6).toUpperCase()}`;
}

function ensureReimbursementVoucher(db: Database.Database, row: Record<string, any>, actor: string, actorUid: number | null, automatic = false) {
  if (row.voucher_no) return { voucherNo: row.voucher_no, createdAt: row.voucher_created_at };
  const voucherNo = reimbursementVoucherNo(String(row.id), String(row.advance_date));
  const createdAt = now();
  db.prepare('UPDATE reimbursements_simple SET voucher_no=?, voucher_created_at=? WHERE id=?').run(voucherNo, createdAt, row.id);
  recordAudit(db, { actorName: actor, actorUid, action: 'generate_voucher', entityType: 'reimbursement', entityId: String(row.id), detail: { voucher_no: voucherNo, automatic } });
  return { voucherNo, createdAt };
}

/** 把乘积四舍五入到分，避免浮点误差（如 454×17.4 = 7899.599999999999）。 */
function lineTotalYuan(item: Record<string, unknown>): number {
  return Math.round(Number(item.quantity || 0) * Number(item.unit_price || 0) * 100) / 100;
}

/** 订单状态为二态：“已提交/已完成”，历史值（如“制作中/待确认”）统一归并为“已提交”。 */
function normalizeOrderStatus(value: unknown): '已提交' | '已完成' {
  return text(value) === '已完成' ? '已完成' : '已提交';
}

/** 过滤掉关键名称为空且金额也为 0/空的行（用户点了“添加”但未填写），再检查是否至少有一行有效。 */
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
  if (version && Number(version.value) >= 22) return;
  if (version?.value === '21') {
    db.exec(`ALTER TABLE orders_simple ADD COLUMN execution_company TEXT NOT NULL DEFAULT ''; UPDATE schema_meta SET value='22' WHERE key='order_app_version';`);
    return;
  }
  if (version?.value === '20') {
    db.exec(`ALTER TABLE orders_simple ADD COLUMN planner TEXT NOT NULL DEFAULT ''; ALTER TABLE orders_simple ADD COLUMN execution_company TEXT NOT NULL DEFAULT ''; UPDATE schema_meta SET value='22' WHERE key='order_app_version';`);
    return;
  }
  if (version?.value === '19') {
    db.exec(`
      CREATE TABLE catalog_sources_v20(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('quote','cost')), owner_name TEXT NOT NULL, source_file TEXT NOT NULL DEFAULT '', source_method TEXT NOT NULL DEFAULT 'manual', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, import_summary_json TEXT NOT NULL DEFAULT '{}', UNIQUE(kind,owner_name));
      CREATE TABLE orders_simple_v20(id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL, project_id TEXT NOT NULL, catalog_id TEXT, service_name TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 1, unit TEXT NOT NULL DEFAULT '项', quote_amount INTEGER NOT NULL DEFAULT 0, cost_amount INTEGER NOT NULL DEFAULT 0, order_date TEXT NOT NULL, delivery_date TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', customer_department TEXT NOT NULL DEFAULT '', designer TEXT NOT NULL DEFAULT '', planner TEXT NOT NULL DEFAULT '', execution_company TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT '已提交', payment_status TEXT NOT NULL DEFAULT '未结款', note TEXT NOT NULL DEFAULT '', specification TEXT NOT NULL DEFAULT '', products_json TEXT NOT NULL DEFAULT '[]', costs_json TEXT NOT NULL DEFAULT '[]', is_extra INTEGER NOT NULL DEFAULT 0, idempotency_key TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, FOREIGN KEY(customer_id) REFERENCES customers_simple(id), FOREIGN KEY(project_id) REFERENCES projects_simple(id), FOREIGN KEY(catalog_id) REFERENCES catalog_items(id));
      CREATE TABLE order_attachments_v20(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT '', file_size INTEGER NOT NULL DEFAULT 0, storage_path TEXT NOT NULL DEFAULT '', attachment_kind TEXT NOT NULL DEFAULT 'note', visibility TEXT NOT NULL DEFAULT 'order', created_at TEXT NOT NULL, FOREIGN KEY(order_id) REFERENCES orders_simple(id) ON DELETE CASCADE);
      CREATE TABLE reimbursements_simple_v20(id TEXT PRIMARY KEY, employee TEXT NOT NULL, item TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0, advance_date TEXT NOT NULL, order_id TEXT, invoice TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','rejected','pending_payment','paid')), reject_reason TEXT NOT NULL DEFAULT '', reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at TEXT, reimbursed_by TEXT NOT NULL DEFAULT '', reimbursed_at TEXT, voucher_no TEXT NOT NULL DEFAULT '', voucher_created_at TEXT, voucher_archived_at TEXT, created_at TEXT NOT NULL, FOREIGN KEY(order_id) REFERENCES orders_simple(id) ON DELETE CASCADE);
      CREATE TABLE reimbursement_attachments_v20(id TEXT PRIMARY KEY, reimbursement_id TEXT NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT '', file_size INTEGER NOT NULL DEFAULT 0, storage_path TEXT NOT NULL DEFAULT '', attachment_kind TEXT NOT NULL DEFAULT 'invoice', visibility TEXT NOT NULL DEFAULT 'participants', created_at TEXT NOT NULL, FOREIGN KEY(reimbursement_id) REFERENCES reimbursements_simple(id) ON DELETE CASCADE);
      CREATE TABLE audit_logs_v20(id TEXT PRIMARY KEY, actor_name TEXT NOT NULL DEFAULT '', action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL DEFAULT '', from_value TEXT NOT NULL DEFAULT '', to_value TEXT NOT NULL DEFAULT '', detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);

      INSERT INTO catalog_sources_v20(id,kind,owner_name,source_file,source_method,active,created_at,updated_at,import_summary_json) SELECT id,kind,owner_name,source_file,source_method,active,created_at,updated_at,import_summary_json FROM catalog_sources;
      INSERT INTO orders_simple_v20(id,code,customer_id,project_id,catalog_id,service_name,quantity,unit,quote_amount,cost_amount,order_date,delivery_date,contact,customer_department,designer,planner,created_by,status,payment_status,note,specification,products_json,costs_json,is_extra,idempotency_key,created_at) SELECT id,code,customer_id,project_id,catalog_id,service_name,quantity,unit,quote_amount,cost_amount,order_date,delivery_date,contact,customer_department,designer,'',created_by,status,payment_status,note,specification,products_json,costs_json,is_extra,idempotency_key,created_at FROM orders_simple;
      INSERT INTO order_attachments_v20(id,order_id,file_name,mime_type,file_size,storage_path,attachment_kind,visibility,created_at) SELECT id,order_id,file_name,mime_type,file_size,storage_path,attachment_kind,visibility,created_at FROM order_attachments;
      INSERT INTO reimbursements_simple_v20(id,employee,item,amount,advance_date,order_id,invoice,note,status,reject_reason,reviewed_by,reviewed_at,reimbursed_by,reimbursed_at,voucher_no,voucher_created_at,voucher_archived_at,created_at) SELECT id,employee,item,amount,advance_date,order_id,invoice,note,status,reject_reason,reviewed_by,reviewed_at,reimbursed_by,reimbursed_at,voucher_no,voucher_created_at,voucher_archived_at,created_at FROM reimbursements_simple;
      INSERT INTO reimbursement_attachments_v20(id,reimbursement_id,file_name,mime_type,file_size,storage_path,attachment_kind,visibility,created_at) SELECT id,reimbursement_id,file_name,mime_type,file_size,storage_path,attachment_kind,visibility,created_at FROM reimbursement_attachments;
      INSERT INTO audit_logs_v20(id,actor_name,action,entity_type,entity_id,from_value,to_value,detail_json,created_at) SELECT id,actor_name,action,entity_type,entity_id,from_value,to_value,detail_json,created_at FROM audit_logs;

      DROP TABLE reimbursement_attachments;
      DROP TABLE order_attachments;
      DROP TABLE reimbursements_simple;
      DROP TABLE orders_simple;
      DROP TABLE catalog_sources;
      DROP TABLE audit_logs;
      ALTER TABLE catalog_sources_v20 RENAME TO catalog_sources;
      ALTER TABLE orders_simple_v20 RENAME TO orders_simple;
      ALTER TABLE order_attachments_v20 RENAME TO order_attachments;
      ALTER TABLE reimbursements_simple_v20 RENAME TO reimbursements_simple;
      ALTER TABLE reimbursement_attachments_v20 RENAME TO reimbursement_attachments;
      ALTER TABLE audit_logs_v20 RENAME TO audit_logs;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS users;
      CREATE INDEX idx_simple_orders_date ON orders_simple(order_date DESC);
      CREATE INDEX idx_simple_orders_customer ON orders_simple(customer_id,project_id);
      CREATE UNIQUE INDEX idx_orders_idempotency ON orders_simple(idempotency_key) WHERE idempotency_key <> '';
      CREATE INDEX idx_simple_reimbursements_date ON reimbursements_simple(advance_date DESC);
      CREATE INDEX idx_simple_reimbursements_order ON reimbursements_simple(order_id);
      CREATE UNIQUE INDEX idx_reimbursements_voucher_no ON reimbursements_simple(voucher_no) WHERE voucher_no <> '';
      CREATE INDEX idx_audit_entity ON audit_logs(entity_type,entity_id,created_at DESC);
      UPDATE schema_meta SET value='22' WHERE key='order_app_version';
    `);
    return;
  }
  if (version?.value === '18') {
    db.exec(`
      ALTER TABLE orders_simple ADD COLUMN idempotency_key TEXT NOT NULL DEFAULT '';
      CREATE UNIQUE INDEX idx_orders_idempotency ON orders_simple(idempotency_key) WHERE idempotency_key <> '';
      UPDATE schema_meta SET value='19' WHERE key='order_app_version';
    `);
    migrate(db);
    return;
  }
  if (version?.value === '17') {
    db.exec(`
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS users;
      UPDATE schema_meta SET value='18' WHERE key='order_app_version';
    `);
    migrate(db);
    return;
  }
  if (version?.value === '16') {
    db.exec(`
      ALTER TABLE reimbursements_simple ADD COLUMN voucher_archived_at TEXT;
      ALTER TABLE catalog_sources ADD COLUMN import_summary_json TEXT NOT NULL DEFAULT '{}';
      UPDATE catalog_items SET customer_name=(SELECT owner_name FROM catalog_sources WHERE id=catalog_items.source_id)
        WHERE customer_name='' AND source_id IN (SELECT id FROM catalog_sources WHERE kind='cost');
      UPDATE schema_meta SET value='17' WHERE key='order_app_version';
    `);
    migrate(db);
    return;
  }
  if (version?.value === '15') {
    db.exec(`
      ALTER TABLE order_attachments ADD COLUMN visibility TEXT NOT NULL DEFAULT 'order';
      ALTER TABLE reimbursement_attachments ADD COLUMN visibility TEXT NOT NULL DEFAULT 'participants';
      UPDATE schema_meta SET value='16' WHERE key='order_app_version';
    `);
    migrate(db);
    return;
  }
  if (version?.value === '14') {
    db.exec(`
      CREATE TABLE order_products(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, catalog_item_id TEXT, name TEXT NOT NULL, specification TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '项', quantity REAL NOT NULL DEFAULT 1, unit_price INTEGER NOT NULL DEFAULT 0, subtotal INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(order_id) REFERENCES orders_simple(id) ON DELETE CASCADE, FOREIGN KEY(catalog_item_id) REFERENCES catalog_items(id) ON DELETE SET NULL);
      CREATE TABLE order_costs(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, catalog_item_id TEXT, name TEXT NOT NULL, vendor TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '项', quantity REAL NOT NULL DEFAULT 1, unit_price INTEGER NOT NULL DEFAULT 0, subtotal INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(order_id) REFERENCES orders_simple(id) ON DELETE CASCADE, FOREIGN KEY(catalog_item_id) REFERENCES catalog_items(id) ON DELETE SET NULL);
      CREATE INDEX idx_order_products_order ON order_products(order_id,position);
      CREATE INDEX idx_order_costs_order ON order_costs(order_id,position);
    `);
    const productInsert = db.prepare('INSERT INTO order_products(id,order_id,position,catalog_item_id,name,specification,unit,quantity,unit_price,subtotal) VALUES(?,?,?,?,?,?,?,?,?,?)');
    const costInsert = db.prepare('INSERT INTO order_costs(id,order_id,position,catalog_item_id,name,vendor,unit,quantity,unit_price,subtotal) VALUES(?,?,?,?,?,?,?,?,?,?)');
    const oldOrders = db.prepare('SELECT id,products_json,costs_json FROM orders_simple').all() as Array<Record<string, unknown>>;
    for (const order of oldOrders) {
      parseList(order.products_json).forEach((item, index) => productInsert.run(uuid(), order.id, index, text(item.catalog_id) || null, text(item.name), text(item.specification), text(item.unit) || '项', Number(item.quantity || 1), optionalMoneyToCents(item.unit_price), optionalMoneyToCents(item.subtotal || lineTotalYuan(item))));
      parseList(order.costs_json).forEach((item, index) => costInsert.run(uuid(), order.id, index, text(item.catalog_id) || null, text(item.name), text(item.vendor), text(item.unit) || '项', Number(item.quantity || 1), optionalMoneyToCents(item.unit_price), optionalMoneyToCents(item.subtotal || lineTotalYuan(item))));
    }
    db.prepare("UPDATE schema_meta SET value='15' WHERE key='order_app_version'").run();
    migrate(db);
    return;
  }
  if (version?.value === '13') {
    db.exec(`
      CREATE TABLE catalog_sources(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('quote','cost')), owner_name TEXT NOT NULL, source_file TEXT NOT NULL DEFAULT '', source_method TEXT NOT NULL DEFAULT 'manual', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(kind,owner_name));
      ALTER TABLE catalog_items ADD COLUMN source_id TEXT REFERENCES catalog_sources(id) ON DELETE SET NULL;
      CREATE INDEX idx_catalog_source ON catalog_items(source_id,active);
    `);
    const rows = db.prepare('SELECT DISTINCT source_type,source_file,customer_name FROM catalog_items').all() as Array<Record<string, unknown>>;
    const insertSource = db.prepare('INSERT OR IGNORE INTO catalog_sources(id,kind,owner_name,source_file,source_method,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
    for (const row of rows) {
      const kind = text(row.source_type) === 'supplier_cost' ? 'cost' : 'quote';
      const owner = kind === 'quote' ? text(row.customer_name) || '通用客户报价' : text(row.source_file).replace(/\.(xlsx?|csv)$/i, '') || '通用厂商成本';
      insertSource.run(uuid(), kind, owner, text(row.source_file), text(row.source_type) || 'legacy', now(), now());
      db.prepare('UPDATE catalog_items SET source_id=(SELECT id FROM catalog_sources WHERE kind=? AND owner_name=?) WHERE source_type=? AND source_file=? AND customer_name=?').run(kind, owner, text(row.source_type), text(row.source_file), text(row.customer_name));
    }
    db.prepare("UPDATE schema_meta SET value='14' WHERE key='order_app_version'").run();
    migrate(db);
    return;
  }
  if (version?.value === '12') {
    db.exec(`
      ALTER TABLE reimbursement_attachments RENAME TO reimbursement_attachments_v12;
      ALTER TABLE reimbursements_simple RENAME TO reimbursements_simple_v12;
      CREATE TABLE reimbursements_simple(id TEXT PRIMARY KEY, employee TEXT NOT NULL, item TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0, advance_date TEXT NOT NULL, order_id TEXT, invoice TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','rejected','pending_payment','paid')), reject_reason TEXT NOT NULL DEFAULT '', reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at TEXT, reimbursed_by TEXT NOT NULL DEFAULT '', reimbursed_at TEXT, voucher_no TEXT NOT NULL DEFAULT '', voucher_created_at TEXT, created_at TEXT NOT NULL, FOREIGN KEY(order_id) REFERENCES orders_simple(id) ON DELETE CASCADE);
      CREATE TABLE reimbursement_attachments(id TEXT PRIMARY KEY, reimbursement_id TEXT NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT '', file_size INTEGER NOT NULL DEFAULT 0, storage_path TEXT NOT NULL DEFAULT '', attachment_kind TEXT NOT NULL DEFAULT 'invoice', created_at TEXT NOT NULL, FOREIGN KEY(reimbursement_id) REFERENCES reimbursements_simple(id) ON DELETE CASCADE);
      INSERT INTO reimbursements_simple(id,employee,item,amount,advance_date,order_id,invoice,note,status,reject_reason,reviewed_by,reviewed_at,reimbursed_by,reimbursed_at,voucher_no,voucher_created_at,created_at)
        SELECT id,employee,item,amount,advance_date,order_id,invoice,note,CASE status WHEN '待核验' THEN 'pending_review' WHEN '待审核' THEN 'pending_review' WHEN '已打回' THEN 'rejected' WHEN '待报销' THEN 'pending_payment' WHEN '已报销' THEN 'paid' ELSE 'pending_review' END,reject_reason,reviewed_by,reviewed_at,reimbursed_by,reimbursed_at,voucher_no,voucher_created_at,created_at FROM reimbursements_simple_v12;
      INSERT INTO reimbursement_attachments(id,reimbursement_id,file_name,mime_type,file_size,storage_path,created_at)
        SELECT id,reimbursement_id,file_name,mime_type,file_size,storage_path,created_at FROM reimbursement_attachments_v12;
      DROP TABLE reimbursement_attachments_v12;
      DROP TABLE reimbursements_simple_v12;
      CREATE TABLE audit_logs(id TEXT PRIMARY KEY, actor_name TEXT NOT NULL DEFAULT '', action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL DEFAULT '', from_value TEXT NOT NULL DEFAULT '', to_value TEXT NOT NULL DEFAULT '', detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      CREATE INDEX idx_simple_reimbursements_date ON reimbursements_simple(advance_date DESC);
      CREATE INDEX idx_simple_reimbursements_order ON reimbursements_simple(order_id);
      CREATE UNIQUE INDEX idx_reimbursements_voucher_no ON reimbursements_simple(voucher_no) WHERE voucher_no <> '';
      CREATE INDEX idx_audit_entity ON audit_logs(entity_type,entity_id,created_at DESC);
      UPDATE schema_meta SET value='13' WHERE key='order_app_version';
    `);
    migrate(db);
    return;
  }
  if (version?.value === '11') {
    db.prepare("UPDATE schema_meta SET value='12' WHERE key='order_app_version'").run();
    migrate(db);
    return;
  }
  if (version?.value === '10') {
    db.exec(`
      ALTER TABLE reimbursements_simple ADD COLUMN voucher_no TEXT NOT NULL DEFAULT '';
      ALTER TABLE reimbursements_simple ADD COLUMN voucher_created_at TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_reimbursements_voucher_no ON reimbursements_simple(voucher_no) WHERE voucher_no <> '';
      UPDATE reimbursements_simple SET voucher_no='BX-' || replace(advance_date, '-', '') || '-' || upper(substr(replace(id, '-', ''), 1, 6)), voucher_created_at=created_at WHERE status IN ('待报销','已报销') AND voucher_no='';
      UPDATE schema_meta SET value='11' WHERE key='order_app_version';
    `);
    migrate(db);
    return;
  }
  if (version?.value === '9') {
    // Rebuild both tables together. SQLite rewrites child-table foreign keys when a
    // referenced table is renamed, so renaming only reimbursements_simple would leave
    // reimbursement_attachments pointing at the removed *_old table.
    db.exec(`
      ALTER TABLE reimbursement_attachments RENAME TO reimbursement_attachments_old;
      ALTER TABLE reimbursements_simple RENAME TO reimbursements_simple_old;
      CREATE TABLE reimbursements_simple(id TEXT PRIMARY KEY, employee TEXT NOT NULL, item TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0, advance_date TEXT NOT NULL, order_id TEXT, invoice TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '待核验' CHECK(status IN ('待核验','已打回','待报销','已报销')), reject_reason TEXT NOT NULL DEFAULT '', reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at TEXT, reimbursed_by TEXT NOT NULL DEFAULT '', reimbursed_at TEXT, voucher_no TEXT NOT NULL DEFAULT '', voucher_created_at TEXT, created_at TEXT NOT NULL, FOREIGN KEY(order_id) REFERENCES orders_simple(id) ON DELETE CASCADE);
      CREATE TABLE reimbursement_attachments(id TEXT PRIMARY KEY, reimbursement_id TEXT NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT '', file_size INTEGER NOT NULL DEFAULT 0, storage_path TEXT NOT NULL DEFAULT '', attachment_kind TEXT NOT NULL DEFAULT 'note', created_at TEXT NOT NULL, FOREIGN KEY(reimbursement_id) REFERENCES reimbursements_simple(id) ON DELETE CASCADE);
      INSERT INTO reimbursements_simple(id,employee,item,amount,advance_date,order_id,invoice,note,status,reviewed_by,reviewed_at,reimbursed_by,reimbursed_at,created_at)
        SELECT id,employee,item,amount,advance_date,order_id,invoice,note,status,reviewed_by,reviewed_at,reimbursed_by,reimbursed_at,created_at FROM reimbursements_simple_old;
      INSERT INTO reimbursement_attachments(id,reimbursement_id,file_name,mime_type,file_size,storage_path,created_at)
        SELECT id,reimbursement_id,file_name,mime_type,file_size,storage_path,created_at FROM reimbursement_attachments_old;
      DROP TABLE reimbursement_attachments_old;
      DROP TABLE reimbursements_simple_old;
      CREATE INDEX IF NOT EXISTS idx_simple_reimbursements_date ON reimbursements_simple(advance_date DESC);
      CREATE INDEX IF NOT EXISTS idx_simple_reimbursements_order ON reimbursements_simple(order_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_reimbursements_voucher_no ON reimbursements_simple(voucher_no) WHERE voucher_no <> '';
      UPDATE reimbursements_simple SET voucher_no='BX-' || replace(advance_date, '-', '') || '-' || upper(substr(replace(id, '-', ''), 1, 6)), voucher_created_at=created_at WHERE status IN ('待报销','已报销') AND voucher_no='';
      UPDATE schema_meta SET value='11' WHERE key='order_app_version';
    `);
    migrate(db);
    return;
  }
  db.exec(`
    CREATE TABLE customers_simple(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, contact TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
    CREATE TABLE projects_simple(id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, name TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '进行中', created_at TEXT NOT NULL, UNIQUE(customer_id,name), FOREIGN KEY(customer_id) REFERENCES customers_simple(id) ON DELETE CASCADE);
    CREATE TABLE catalog_sources(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('quote','cost')), owner_name TEXT NOT NULL, source_file TEXT NOT NULL DEFAULT '', source_method TEXT NOT NULL DEFAULT 'manual', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, import_summary_json TEXT NOT NULL DEFAULT '{}', UNIQUE(kind,owner_name));
    CREATE TABLE catalog_items(id TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '项', quote_unit INTEGER NOT NULL DEFAULT 0, cost_unit INTEGER NOT NULL DEFAULT 0, customer_name TEXT NOT NULL DEFAULT '', project_name TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, source_file TEXT NOT NULL DEFAULT '', source_sheet TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL DEFAULT 'manual', item_no TEXT NOT NULL DEFAULT '', specification TEXT NOT NULL DEFAULT '', estimated_quantity TEXT NOT NULL DEFAULT '', max_quote_unit INTEGER NOT NULL DEFAULT 0, supplier_remark TEXT NOT NULL DEFAULT '', raw_data TEXT NOT NULL DEFAULT '{}', source_id TEXT REFERENCES catalog_sources(id) ON DELETE SET NULL, UNIQUE(category,name,customer_name,project_name,specification,estimated_quantity));
    CREATE TABLE orders_simple(id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL, project_id TEXT NOT NULL, catalog_id TEXT, service_name TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 1, unit TEXT NOT NULL DEFAULT '项', quote_amount INTEGER NOT NULL DEFAULT 0, cost_amount INTEGER NOT NULL DEFAULT 0, order_date TEXT NOT NULL, delivery_date TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', customer_department TEXT NOT NULL DEFAULT '', designer TEXT NOT NULL DEFAULT '', planner TEXT NOT NULL DEFAULT '', execution_company TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT '已提交' CHECK(status IN ('已提交','已完成')), payment_status TEXT NOT NULL DEFAULT '未结款', note TEXT NOT NULL DEFAULT '', specification TEXT NOT NULL DEFAULT '', products_json TEXT NOT NULL DEFAULT '[]', costs_json TEXT NOT NULL DEFAULT '[]', is_extra INTEGER NOT NULL DEFAULT 0, idempotency_key TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, FOREIGN KEY(customer_id) REFERENCES customers_simple(id), FOREIGN KEY(project_id) REFERENCES projects_simple(id), FOREIGN KEY(catalog_id) REFERENCES catalog_items(id));
    CREATE TABLE order_products(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, catalog_item_id TEXT, name TEXT NOT NULL, specification TEXT NOT NULL DEFAULT '', remark TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '项', quantity REAL NOT NULL DEFAULT 1, unit_price INTEGER NOT NULL DEFAULT 0, subtotal INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(order_id) REFERENCES orders_simple(id) ON DELETE CASCADE, FOREIGN KEY(catalog_item_id) REFERENCES catalog_items(id) ON DELETE SET NULL);
    CREATE TABLE order_costs(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, catalog_item_id TEXT, name TEXT NOT NULL, vendor TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '项', quantity REAL NOT NULL DEFAULT 1, unit_price INTEGER NOT NULL DEFAULT 0, subtotal INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(order_id) REFERENCES orders_simple(id) ON DELETE CASCADE, FOREIGN KEY(catalog_item_id) REFERENCES catalog_items(id) ON DELETE SET NULL);
    CREATE TABLE order_attachments(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT '', file_size INTEGER NOT NULL DEFAULT 0, storage_path TEXT NOT NULL DEFAULT '', attachment_kind TEXT NOT NULL DEFAULT 'note', visibility TEXT NOT NULL DEFAULT 'order', created_at TEXT NOT NULL, FOREIGN KEY(order_id) REFERENCES orders_simple(id) ON DELETE CASCADE);
    CREATE TABLE reimbursements_simple(id TEXT PRIMARY KEY, employee TEXT NOT NULL, item TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0, advance_date TEXT NOT NULL, order_id TEXT, invoice TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','rejected','pending_payment','paid')), reject_reason TEXT NOT NULL DEFAULT '', reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at TEXT, reimbursed_by TEXT NOT NULL DEFAULT '', reimbursed_at TEXT, voucher_no TEXT NOT NULL DEFAULT '', voucher_created_at TEXT, voucher_archived_at TEXT, created_at TEXT NOT NULL, FOREIGN KEY(order_id) REFERENCES orders_simple(id) ON DELETE CASCADE);
    CREATE TABLE reimbursement_attachments(id TEXT PRIMARY KEY, reimbursement_id TEXT NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT '', file_size INTEGER NOT NULL DEFAULT 0, storage_path TEXT NOT NULL DEFAULT '', attachment_kind TEXT NOT NULL DEFAULT 'invoice', visibility TEXT NOT NULL DEFAULT 'participants', created_at TEXT NOT NULL, FOREIGN KEY(reimbursement_id) REFERENCES reimbursements_simple(id) ON DELETE CASCADE);
    CREATE TABLE audit_logs(id TEXT PRIMARY KEY, actor_name TEXT NOT NULL DEFAULT '', actor_uid INTEGER, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL DEFAULT '', from_value TEXT NOT NULL DEFAULT '', to_value TEXT NOT NULL DEFAULT '', detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
    CREATE INDEX idx_simple_orders_date ON orders_simple(order_date DESC);
    CREATE INDEX idx_simple_orders_customer ON orders_simple(customer_id,project_id);
    CREATE UNIQUE INDEX idx_orders_idempotency ON orders_simple(idempotency_key) WHERE idempotency_key <> '';
    CREATE INDEX idx_simple_reimbursements_date ON reimbursements_simple(advance_date DESC);
    CREATE INDEX idx_simple_reimbursements_order ON reimbursements_simple(order_id);
    CREATE UNIQUE INDEX idx_reimbursements_voucher_no ON reimbursements_simple(voucher_no) WHERE voucher_no <> '';
    CREATE INDEX idx_catalog_source ON catalog_items(source_id,active);
    CREATE INDEX idx_order_products_order ON order_products(order_id,position);
    CREATE INDEX idx_order_costs_order ON order_costs(order_id,position);
    CREATE INDEX idx_audit_entity ON audit_logs(entity_type,entity_id,created_at DESC);
    INSERT INTO schema_meta(key,value) VALUES('order_app_version','22');
  `);
}

export function getOrderDb() {
  if (!instance) {
    mkdirSync(dirname(databasePath), { recursive: true });
    instance = new Database(databasePath);
    instance.pragma('journal_mode = WAL');
    instance.pragma('foreign_keys = OFF');
    try {
      instance.transaction(() => { migrate(instance!); })();
    } finally {
      instance.pragma('foreign_keys = ON');
    }
    const violations = instance.pragma('foreign_key_check') as Array<Record<string, unknown>>;
    if (violations.length) throw new Error(`数据库迁移后存在 ${violations.length} 条外键异常`);




    instance.exec(`
      CREATE TABLE IF NOT EXISTS system_admin_identity (
        uid INTEGER PRIMARY KEY,
        role TEXT NOT NULL CHECK(role IN ('executor','designer','business','planner','finance','owner')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS employees (
        catsco_uid INTEGER PRIMARY KEY,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        department TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'pending' CHECK(role IN ('pending','executor','designer','business','planner','finance','owner')),
        active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS execution_companies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      -- 客户档案独立维护开票资料，暂不与订单、报价库等其他业务数据关联。
      CREATE TABLE IF NOT EXISTS customer_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        tax_no TEXT NOT NULL DEFAULT '',
        contact TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        bank_name TEXT NOT NULL DEFAULT '',
        bank_account TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      -- 按部门配置三级报销审核人；同一部门同一级可配置多人。
      CREATE TABLE IF NOT EXISTS department_approvers (
        id TEXT PRIMARY KEY,
        department TEXT NOT NULL,
        layer INTEGER NOT NULL CHECK(layer BETWEEN 1 AND 3),
        employee_uid INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(department,layer,employee_uid),
        FOREIGN KEY(employee_uid) REFERENCES employees(catsco_uid) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_department_approvers ON department_approvers(department,layer);
      -- 每次审核/打回/重新提交都留痕，便于报销详情展示完整审批链。
      CREATE TABLE IF NOT EXISTS reimbursement_approvals (
        id TEXT PRIMARY KEY,
        reimbursement_id TEXT NOT NULL,
        layer INTEGER NOT NULL,
        action TEXT NOT NULL,
        approver_uid INTEGER,
        approver_name TEXT NOT NULL DEFAULT '',
        comment TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY(reimbursement_id) REFERENCES reimbursements_simple(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_reimbursement_approvals ON reimbursement_approvals(reimbursement_id,created_at);
    `);
    // 首次初始化时写入默认执行公司，与原前端内置的三项默认值保持一致。
    const executionCompanyCount = (instance.prepare('SELECT COUNT(*) AS count FROM execution_companies').get() as { count: number }).count;
    if (!executionCompanyCount) {
      const timestamp = now();
      const insertExecutionCompany = instance.prepare('INSERT INTO execution_companies(id,name,sort_order,created_at,updated_at) VALUES(?,?,?,?,?)');
      ['执行公司一', '执行公司二', '执行公司三'].forEach((name, index) => insertExecutionCompany.run(uuid(), name, index, timestamp, timestamp));
    }
    const orderColumns = new Set((instance.pragma('table_info(orders_simple)') as Array<{ name: string }>).map((column) => column.name));
    for (const column of ['created_by_uid', 'designer_uid', 'planner_uid']) {
      if (!orderColumns.has(column)) instance.exec(`ALTER TABLE orders_simple ADD COLUMN ${column} INTEGER`);
    }
    // v28：订单项增加行备注，和订单级备注分开；历史订单行默认为空，导出时回退到订单备注。
    const productColumns = new Set((instance.pragma('table_info(order_products)') as Array<{ name: string }>).map((column) => column.name));
    if (!productColumns.has('remark')) instance.exec("ALTER TABLE order_products ADD COLUMN remark TEXT NOT NULL DEFAULT ''");
    const reimbursementColumns = new Set((instance.pragma('table_info(reimbursements_simple)') as Array<{ name: string }>).map((column) => column.name));
    if (!reimbursementColumns.has('employee_uid')) instance.exec('ALTER TABLE reimbursements_simple ADD COLUMN employee_uid INTEGER');
    if (!reimbursementColumns.has('department')) instance.exec("ALTER TABLE reimbursements_simple ADD COLUMN department TEXT NOT NULL DEFAULT ''");
    const auditColumns = new Set((instance.pragma('table_info(audit_logs)') as Array<{ name: string }>).map((column) => column.name));
    if (!auditColumns.has('actor_uid')) instance.exec('ALTER TABLE audit_logs ADD COLUMN actor_uid INTEGER');
    // 用数值比较而不是 !== 逐个排除：v27 的库第二次启动时，旧写法会把版本退回 25 并重复执行 v26，
    // 而 v26 需要已被 v27 删除的 catalog_items，导致每次启动都抛错。
    const appVersion = Number(instance.prepare("SELECT value FROM schema_meta WHERE key='order_app_version'").pluck().get()) || 0;
    if (appVersion < 25) {
      instance.transaction(() => {
        instance!.exec(`
          CREATE TABLE reimbursements_next (
            id TEXT PRIMARY KEY, employee TEXT NOT NULL, item TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0,
            advance_date TEXT NOT NULL, order_id TEXT, invoice TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','pending_recheck','pending_confirmation','pending_payment','paid','rejected')),
            reject_reason TEXT NOT NULL DEFAULT '', reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at TEXT,
            reimbursed_by TEXT NOT NULL DEFAULT '', reimbursed_at TEXT, voucher_no TEXT NOT NULL DEFAULT '',
            voucher_created_at TEXT, voucher_archived_at TEXT, created_at TEXT NOT NULL, employee_uid INTEGER,
            department TEXT NOT NULL DEFAULT '',
            FOREIGN KEY(order_id) REFERENCES orders_simple(id) ON DELETE CASCADE
          );
          INSERT INTO reimbursements_next(id,employee,item,amount,advance_date,order_id,invoice,note,status,reject_reason,reviewed_by,reviewed_at,reimbursed_by,reimbursed_at,voucher_no,voucher_created_at,voucher_archived_at,created_at,employee_uid,department)
            SELECT id,employee,item,amount,advance_date,order_id,invoice,note,status,reject_reason,reviewed_by,reviewed_at,reimbursed_by,reimbursed_at,voucher_no,voucher_created_at,voucher_archived_at,created_at,employee_uid,department FROM reimbursements_simple;
          DROP TABLE reimbursements_simple;
          ALTER TABLE reimbursements_next RENAME TO reimbursements_simple;
          CREATE INDEX idx_simple_reimbursements_date ON reimbursements_simple(advance_date DESC);
          CREATE INDEX idx_simple_reimbursements_order ON reimbursements_simple(order_id);
          CREATE UNIQUE INDEX idx_reimbursements_voucher_no ON reimbursements_simple(voucher_no) WHERE voucher_no <> '';
          UPDATE schema_meta SET value='25' WHERE key='order_app_version';
        `);
      })();
    }
    if (appVersion < 26) {
      instance.exec(`UPDATE orders_simple SET status='已提交' WHERE status <> '已完成'; UPDATE catalog_items SET source_type='customer_quote' WHERE source_type='enterprise_quote'; UPDATE schema_meta SET value='26' WHERE key='order_app_version';`);
    }
    // v27：报价库/成本库分表；订单行分别外键到对应库，删除 orders_simple.catalog_id。
    if (appVersion < 27) {
      instance.pragma('foreign_keys = OFF');
      try {
        instance.transaction(() => {
          instance!.exec(`
            CREATE TABLE IF NOT EXISTS catalog_quote_items(
              id TEXT PRIMARY KEY,
              source_id TEXT REFERENCES catalog_sources(id) ON DELETE SET NULL,
              active INTEGER NOT NULL DEFAULT 1,
              item_no TEXT NOT NULL DEFAULT '',
              category TEXT NOT NULL DEFAULT '',
              name TEXT NOT NULL,
              specification TEXT NOT NULL DEFAULT '',
              unit TEXT NOT NULL DEFAULT '项',
              estimated_quantity TEXT NOT NULL DEFAULT '',
              price_incl_tax INTEGER NOT NULL DEFAULT 0,
              price_excl_tax INTEGER NOT NULL DEFAULT 0,
              tax_rate TEXT NOT NULL DEFAULT '',
              max_price INTEGER NOT NULL DEFAULT 0,
              customer_name TEXT NOT NULL DEFAULT '',
              project_name TEXT NOT NULL DEFAULT '',
              remark TEXT NOT NULL DEFAULT '',
              source_file TEXT NOT NULL DEFAULT '',
              source_sheet TEXT NOT NULL DEFAULT '',
              source_type TEXT NOT NULL DEFAULT 'customer_quote',
              raw_data TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL,
              UNIQUE(category,name,customer_name,project_name,specification,estimated_quantity)
            );
            CREATE TABLE IF NOT EXISTS catalog_cost_items(
              id TEXT PRIMARY KEY,
              source_id TEXT REFERENCES catalog_sources(id) ON DELETE SET NULL,
              active INTEGER NOT NULL DEFAULT 1,
              item_no TEXT NOT NULL DEFAULT '',
              category TEXT NOT NULL DEFAULT '',
              name TEXT NOT NULL,
              specification TEXT NOT NULL DEFAULT '',
              unit TEXT NOT NULL DEFAULT '项',
              supplier_name TEXT NOT NULL DEFAULT '',
              cost_unit INTEGER NOT NULL DEFAULT 0,
              cost_unit_excl_tax INTEGER NOT NULL DEFAULT 0,
              tax_rate TEXT NOT NULL DEFAULT '',
              min_quantity TEXT NOT NULL DEFAULT '',
              remark TEXT NOT NULL DEFAULT '',
              source_file TEXT NOT NULL DEFAULT '',
              source_sheet TEXT NOT NULL DEFAULT '',
              source_type TEXT NOT NULL DEFAULT 'supplier_cost',
              raw_data TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL,
              UNIQUE(category,name,supplier_name,specification)
            );
            CREATE INDEX IF NOT EXISTS idx_catalog_quote_source ON catalog_quote_items(source_id,active);
            CREATE INDEX IF NOT EXISTS idx_catalog_cost_source ON catalog_cost_items(source_id,active);

            INSERT OR IGNORE INTO catalog_quote_items(id,source_id,active,item_no,category,name,specification,unit,estimated_quantity,price_incl_tax,price_excl_tax,tax_rate,max_price,customer_name,project_name,remark,source_file,source_sheet,source_type,raw_data,created_at)
              SELECT ci.id,ci.source_id,ci.active,ci.item_no,ci.category,ci.name,ci.specification,ci.unit,ci.estimated_quantity,ci.quote_unit,0,'',ci.max_quote_unit,ci.customer_name,ci.project_name,ci.supplier_remark,ci.source_file,ci.source_sheet,ci.source_type,ci.raw_data,ci.created_at
              FROM catalog_items ci LEFT JOIN catalog_sources cs ON cs.id=ci.source_id
              WHERE COALESCE(cs.kind, CASE WHEN ci.source_type='supplier_cost' THEN 'cost' ELSE 'quote' END) <> 'cost';
            INSERT OR IGNORE INTO catalog_cost_items(id,source_id,active,item_no,category,name,specification,unit,supplier_name,cost_unit,cost_unit_excl_tax,tax_rate,min_quantity,remark,source_file,source_sheet,source_type,raw_data,created_at)
              SELECT ci.id,ci.source_id,ci.active,ci.item_no,ci.category,ci.name,ci.specification,ci.unit,COALESCE(cs.owner_name,ci.supplier_remark),ci.cost_unit,0,'','',ci.supplier_remark,ci.source_file,ci.source_sheet,ci.source_type,ci.raw_data,ci.created_at
              FROM catalog_items ci LEFT JOIN catalog_sources cs ON cs.id=ci.source_id
              WHERE COALESCE(cs.kind, CASE WHEN ci.source_type='supplier_cost' THEN 'cost' ELSE 'quote' END)='cost';

            CREATE TABLE orders_simple_v27(
              id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL, project_id TEXT NOT NULL,
              service_name TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 1, unit TEXT NOT NULL DEFAULT '项',
              quote_amount INTEGER NOT NULL DEFAULT 0, cost_amount INTEGER NOT NULL DEFAULT 0, order_date TEXT NOT NULL,
              delivery_date TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', customer_department TEXT NOT NULL DEFAULT '',
              designer TEXT NOT NULL DEFAULT '', planner TEXT NOT NULL DEFAULT '', execution_company TEXT NOT NULL DEFAULT '',
              created_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT '已提交' CHECK(status IN ('已提交','已完成')),
              payment_status TEXT NOT NULL DEFAULT '未结款', note TEXT NOT NULL DEFAULT '', specification TEXT NOT NULL DEFAULT '',
              products_json TEXT NOT NULL DEFAULT '[]', costs_json TEXT NOT NULL DEFAULT '[]', is_extra INTEGER NOT NULL DEFAULT 0,
              idempotency_key TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by_uid INTEGER, designer_uid INTEGER, planner_uid INTEGER,
              FOREIGN KEY(customer_id) REFERENCES customers_simple(id), FOREIGN KEY(project_id) REFERENCES projects_simple(id)
            );
            INSERT INTO orders_simple_v27(id,code,customer_id,project_id,service_name,quantity,unit,quote_amount,cost_amount,order_date,delivery_date,contact,customer_department,designer,planner,execution_company,created_by,status,payment_status,note,specification,products_json,costs_json,is_extra,idempotency_key,created_at,created_by_uid,designer_uid,planner_uid)
              SELECT id,code,customer_id,project_id,service_name,quantity,unit,quote_amount,cost_amount,order_date,delivery_date,contact,customer_department,designer,planner,execution_company,created_by,status,payment_status,note,specification,products_json,costs_json,is_extra,idempotency_key,created_at,created_by_uid,designer_uid,planner_uid FROM orders_simple;
            DROP TABLE orders_simple;
            ALTER TABLE orders_simple_v27 RENAME TO orders_simple;
            CREATE INDEX idx_simple_orders_date ON orders_simple(order_date DESC);
            CREATE INDEX idx_simple_orders_customer ON orders_simple(customer_id,project_id);
            CREATE UNIQUE INDEX idx_orders_idempotency ON orders_simple(idempotency_key) WHERE idempotency_key <> '';

            CREATE TABLE order_products_v27(
              id TEXT PRIMARY KEY, order_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, catalog_item_id TEXT,
              name TEXT NOT NULL, specification TEXT NOT NULL DEFAULT '', remark TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '项',
              quantity REAL NOT NULL DEFAULT 1, unit_price INTEGER NOT NULL DEFAULT 0, subtotal INTEGER NOT NULL DEFAULT 0,
              FOREIGN KEY(order_id) REFERENCES orders_simple(id) ON DELETE CASCADE,
              FOREIGN KEY(catalog_item_id) REFERENCES catalog_quote_items(id) ON DELETE SET NULL
            );
            INSERT INTO order_products_v27(id,order_id,position,catalog_item_id,name,specification,unit,quantity,unit_price,subtotal)
              SELECT id,order_id,position,CASE WHEN catalog_item_id IN (SELECT id FROM catalog_quote_items) THEN catalog_item_id ELSE NULL END,name,specification,unit,quantity,unit_price,subtotal FROM order_products;
            DROP TABLE order_products;
            ALTER TABLE order_products_v27 RENAME TO order_products;
            CREATE INDEX idx_order_products_order ON order_products(order_id,position);

            CREATE TABLE order_costs_v27(
              id TEXT PRIMARY KEY, order_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, catalog_item_id TEXT,
              name TEXT NOT NULL, vendor TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '项',
              quantity REAL NOT NULL DEFAULT 1, unit_price INTEGER NOT NULL DEFAULT 0, subtotal INTEGER NOT NULL DEFAULT 0,
              FOREIGN KEY(order_id) REFERENCES orders_simple(id) ON DELETE CASCADE,
              FOREIGN KEY(catalog_item_id) REFERENCES catalog_cost_items(id) ON DELETE SET NULL
            );
            INSERT INTO order_costs_v27(id,order_id,position,catalog_item_id,name,vendor,unit,quantity,unit_price,subtotal)
              SELECT id,order_id,position,CASE WHEN catalog_item_id IN (SELECT id FROM catalog_cost_items) THEN catalog_item_id ELSE NULL END,name,vendor,unit,quantity,unit_price,subtotal FROM order_costs;
            DROP TABLE order_costs;
            ALTER TABLE order_costs_v27 RENAME TO order_costs;
            CREATE INDEX idx_order_costs_order ON order_costs(order_id,position);

            DROP TABLE catalog_items;
            UPDATE schema_meta SET value='27' WHERE key='order_app_version';
          `);
        })();
      } finally {
        instance.pragma('foreign_keys = ON');
      }
      const v27Violations = instance.pragma('foreign_key_check') as Array<Record<string, unknown>>;
      if (v27Violations.length) throw new Error(`v27 迁移后存在 ${v27Violations.length} 条外键异常`);
    }
    if (appVersion < 28) {
      instance.pragma('foreign_keys = OFF');
      try {
        instance.transaction(() => {
          instance!.exec(`
            CREATE TABLE catalog_quote_items_v28(
              id TEXT PRIMARY KEY, source_id TEXT REFERENCES catalog_sources(id) ON DELETE SET NULL,
              active INTEGER NOT NULL DEFAULT 1, item_no TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
              name TEXT NOT NULL, specification TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '项',
              estimated_quantity TEXT NOT NULL DEFAULT '', price_incl_tax INTEGER NOT NULL DEFAULT 0,
              max_price INTEGER NOT NULL DEFAULT 0, customer_name TEXT NOT NULL DEFAULT '', project_name TEXT NOT NULL DEFAULT '',
              remark TEXT NOT NULL DEFAULT '', source_file TEXT NOT NULL DEFAULT '', source_sheet TEXT NOT NULL DEFAULT '',
              source_type TEXT NOT NULL DEFAULT 'customer_quote', raw_data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
              UNIQUE(category,name,customer_name,project_name,specification,estimated_quantity)
            );
            INSERT INTO catalog_quote_items_v28 SELECT id,source_id,active,item_no,category,name,specification,unit,estimated_quantity,price_incl_tax,max_price,customer_name,project_name,remark,source_file,source_sheet,source_type,raw_data,created_at FROM catalog_quote_items;
            DROP TABLE catalog_quote_items;
            ALTER TABLE catalog_quote_items_v28 RENAME TO catalog_quote_items;
            CREATE INDEX idx_catalog_quote_source ON catalog_quote_items(source_id,active);

            CREATE TABLE catalog_cost_items_v28(
              id TEXT PRIMARY KEY, source_id TEXT REFERENCES catalog_sources(id) ON DELETE SET NULL,
              active INTEGER NOT NULL DEFAULT 1, item_no TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
              name TEXT NOT NULL, specification TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '项',
              supplier_name TEXT NOT NULL DEFAULT '', cost_unit INTEGER NOT NULL DEFAULT 0,
              min_quantity TEXT NOT NULL DEFAULT '', remark TEXT NOT NULL DEFAULT '', source_file TEXT NOT NULL DEFAULT '',
              source_sheet TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL DEFAULT 'supplier_cost',
              raw_data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
              UNIQUE(category,name,supplier_name,specification)
            );
            INSERT INTO catalog_cost_items_v28 SELECT id,source_id,active,item_no,category,name,specification,unit,supplier_name,cost_unit,min_quantity,remark,source_file,source_sheet,source_type,raw_data,created_at FROM catalog_cost_items;
            DROP TABLE catalog_cost_items;
            ALTER TABLE catalog_cost_items_v28 RENAME TO catalog_cost_items;
            CREATE INDEX idx_catalog_cost_source ON catalog_cost_items(source_id,active);
            UPDATE schema_meta SET value='28' WHERE key='order_app_version';
          `);
        })();
      } finally {
        instance.pragma('foreign_keys = ON');
      }
      const violations = instance.pragma('foreign_key_check') as Array<Record<string, unknown>>;
      if (violations.length) throw new Error(`v28 迁移后存在 ${violations.length} 条外键异常`);
    }
    // v29：客户部门 + 联系人/下单人 合并为「订单来源」，旧数据按「部门-联系人」拼接。
    if (appVersion < 29) {
      instance.pragma('foreign_keys = OFF');
      try {
        instance.transaction(() => {
          instance!.exec(`
            CREATE TABLE orders_simple_v29(
              id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL, project_id TEXT NOT NULL,
              service_name TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 1, unit TEXT NOT NULL DEFAULT '项',
              quote_amount INTEGER NOT NULL DEFAULT 0, cost_amount INTEGER NOT NULL DEFAULT 0, order_date TEXT NOT NULL,
              delivery_date TEXT NOT NULL DEFAULT '', order_source TEXT NOT NULL DEFAULT '',
              designer TEXT NOT NULL DEFAULT '', planner TEXT NOT NULL DEFAULT '', execution_company TEXT NOT NULL DEFAULT '',
              created_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT '已提交' CHECK(status IN ('已提交','已完成')),
              payment_status TEXT NOT NULL DEFAULT '未结款', note TEXT NOT NULL DEFAULT '', specification TEXT NOT NULL DEFAULT '',
              products_json TEXT NOT NULL DEFAULT '[]', costs_json TEXT NOT NULL DEFAULT '[]', is_extra INTEGER NOT NULL DEFAULT 0,
              idempotency_key TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by_uid INTEGER, designer_uid INTEGER, planner_uid INTEGER,
              FOREIGN KEY(customer_id) REFERENCES customers_simple(id), FOREIGN KEY(project_id) REFERENCES projects_simple(id)
            );
            INSERT INTO orders_simple_v29(id,code,customer_id,project_id,service_name,quantity,unit,quote_amount,cost_amount,order_date,delivery_date,order_source,designer,planner,execution_company,created_by,status,payment_status,note,specification,products_json,costs_json,is_extra,idempotency_key,created_at,created_by_uid,designer_uid,planner_uid)
              SELECT id,code,customer_id,project_id,service_name,quantity,unit,quote_amount,cost_amount,order_date,delivery_date,
                CASE
                  WHEN TRIM(COALESCE(customer_department,'')) = '' THEN TRIM(COALESCE(contact,''))
                  WHEN TRIM(COALESCE(contact,'')) = '' THEN TRIM(customer_department)
                  ELSE TRIM(customer_department) || '-' || TRIM(contact)
                END,
                designer,planner,execution_company,created_by,status,payment_status,note,specification,products_json,costs_json,is_extra,idempotency_key,created_at,created_by_uid,designer_uid,planner_uid
              FROM orders_simple;
            DROP TABLE orders_simple;
            ALTER TABLE orders_simple_v29 RENAME TO orders_simple;
            CREATE INDEX idx_simple_orders_date ON orders_simple(order_date DESC);
            CREATE INDEX idx_simple_orders_customer ON orders_simple(customer_id,project_id);
            CREATE UNIQUE INDEX idx_orders_idempotency ON orders_simple(idempotency_key) WHERE idempotency_key <> '';
            UPDATE schema_meta SET value='29' WHERE key='order_app_version';
          `);
        })();
      } finally {
        instance.pragma('foreign_keys = ON');
      }
      const v29Violations = instance.pragma('foreign_key_check') as Array<Record<string, unknown>>;
      if (v29Violations.length) throw new Error(`v29 迁移后存在 ${v29Violations.length} 条外键异常`);
    }
    // v30：同一客户可维护多个报价库/成本库，移除 kind+owner 唯一限制并补充库名称。
    if (appVersion < 30) {
      instance.pragma('foreign_keys = OFF');
      try {
        instance.transaction(() => {
          instance!.exec(`
            CREATE TABLE catalog_sources_v30(
              id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('quote','cost')),
              owner_name TEXT NOT NULL, library_name TEXT NOT NULL DEFAULT '',
              source_file TEXT NOT NULL DEFAULT '', source_method TEXT NOT NULL DEFAULT 'manual',
              active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              import_summary_json TEXT NOT NULL DEFAULT '{}'
            );
            INSERT INTO catalog_sources_v30(id,kind,owner_name,library_name,source_file,source_method,active,created_at,updated_at,import_summary_json)
              SELECT id,kind,owner_name,
                CASE WHEN TRIM(COALESCE(source_file,'')) = ''
                  THEN owner_name
                  ELSE TRIM(REPLACE(REPLACE(REPLACE(source_file,'.xlsx',''),'.xls',''),'.csv',''))
                END,
                source_file,source_method,active,created_at,updated_at,import_summary_json
              FROM catalog_sources;
            DROP TABLE catalog_sources;
            ALTER TABLE catalog_sources_v30 RENAME TO catalog_sources;
            CREATE INDEX IF NOT EXISTS idx_catalog_sources_owner ON catalog_sources(kind,owner_name,active);
            UPDATE schema_meta SET value='30' WHERE key='order_app_version';
          `);
        })();
      } finally {
        instance.pragma('foreign_keys = ON');
      }
      const v30Violations = instance.pragma('foreign_key_check') as Array<Record<string, unknown>>;
      if (v30Violations.length) throw new Error(`v30 迁移后存在 ${v30Violations.length} 条外键异常`);
    }
    // v31：个人垫付按订单行自动生成报销，记录来源行以避免重复创建。
    if (appVersion < 31) {
      instance.transaction(() => {
        const reimbursementColumns = new Set((instance!.pragma('table_info(reimbursements_simple)') as Array<{ name: string }>).map((column) => column.name));
        if (!reimbursementColumns.has('source_line_id')) instance!.exec("ALTER TABLE reimbursements_simple ADD COLUMN source_line_id TEXT NOT NULL DEFAULT ''");
        instance!.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_reimbursements_source_line ON reimbursements_simple(order_id,source_line_id) WHERE source_line_id <> '';
          UPDATE schema_meta SET value='31' WHERE key='order_app_version';
        `);
      })();
    }
    // v32：报销改为按部门配置的三级审核；旧数据按报销人补全部门，未配置部门时继续按原角色兜底。
    if (appVersion < 32) {
      instance.transaction(() => {
        instance!.exec(`
          UPDATE reimbursements_simple
            SET department=COALESCE((SELECT department FROM employees WHERE employees.catsco_uid=reimbursements_simple.employee_uid),'')
            WHERE department='';
          UPDATE schema_meta SET value='32' WHERE key='order_app_version';
        `);
      })();
    }
    // v33：订单/项目客户改为引用客户管理档案；迁移完成后移除 customers_simple。
    // 旧订单客户按 id（同名时按客户档案 id）迁移，报价库历史 owner_name 也补建为最小客户档案。
    if (appVersion < 33) {
      instance.pragma('foreign_keys = OFF');
      try {
        instance.transaction(() => {
          const timestamp = now();
          const hasLegacyCustomers = Boolean(instance!.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='customers_simple'").get());
          const profiles = instance!.prepare('SELECT id,name,contact FROM customer_profiles').all() as Array<{ id: string; name: string; contact: string }>;
          const byId = new Map(profiles.map((profile) => [profile.id, profile]));
          const byName = new Map(profiles.map((profile) => [profile.name, profile]));
          const remap = new Map<string, string>();
          const insertProfile = instance!.prepare(`INSERT OR IGNORE INTO customer_profiles
            (id,name,tax_no,contact,phone,address,bank_name,bank_account,note,created_at,updated_at)
            VALUES(?,?,'',?,'','','','','',?,?)`);
          if (hasLegacyCustomers) {
            const rows = instance!.prepare('SELECT id,name,contact,created_at FROM customers_simple').all() as Array<Record<string, unknown>>;
            for (const row of rows) {
              const id = text(row.id);
              const name = text(row.name);
              if (!name) continue;
              const existing = byId.get(id) || byName.get(name);
              if (existing) {
                if (existing.id !== id) remap.set(id, existing.id);
                if (!text(existing.contact) && text(row.contact)) {
                  instance!.prepare('UPDATE customer_profiles SET contact=? WHERE id=?').run(text(row.contact), existing.id);
                  existing.contact = text(row.contact);
                }
                continue;
              }
              const profile = { id, name, contact: text(row.contact) };
              insertProfile.run(id, name, profile.contact, text(row.created_at) || timestamp, timestamp);
              byId.set(id, profile);
              byName.set(name, profile);
            }
          }
          // 历史报价库 owner_name 没有档案时补建；成本库 owner 是厂商，不写成客户。
          const owners = instance!.prepare("SELECT DISTINCT owner_name FROM catalog_sources WHERE kind='quote'").all() as Array<{ owner_name: string }>;
          for (const owner of owners) {
            const name = text(owner.owner_name);
            if (!name || quoteLibraryPlaceholderOwners.has(name) || byName.has(name)) continue;
            const profile = { id: uuid(), name, contact: '' };
            insertProfile.run(profile.id, name, '', timestamp, timestamp);
            byId.set(profile.id, profile);
            byName.set(name, profile);
          }
          const updateProjectCustomer = instance!.prepare('UPDATE projects_simple SET customer_id=? WHERE customer_id=?');
          const updateOrderCustomer = instance!.prepare('UPDATE orders_simple SET customer_id=? WHERE customer_id=?');
          for (const [oldId, newId] of remap) {
            if (oldId === newId) continue;
            updateProjectCustomer.run(newId, oldId);
            updateOrderCustomer.run(newId, oldId);
          }
          instance!.exec(`
            CREATE TABLE projects_simple_v33(
              id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, name TEXT NOT NULL,
              owner TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '进行中', created_at TEXT NOT NULL,
              UNIQUE(customer_id,name), FOREIGN KEY(customer_id) REFERENCES customer_profiles(id)
            );
            INSERT INTO projects_simple_v33(id,customer_id,name,owner,status,created_at)
              SELECT id,customer_id,name,owner,status,created_at FROM projects_simple;
            DROP TABLE projects_simple;
            ALTER TABLE projects_simple_v33 RENAME TO projects_simple;

            CREATE TABLE orders_simple_v33(
              id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL, project_id TEXT NOT NULL,
              service_name TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 1, unit TEXT NOT NULL DEFAULT '项',
              quote_amount INTEGER NOT NULL DEFAULT 0, cost_amount INTEGER NOT NULL DEFAULT 0, order_date TEXT NOT NULL,
              delivery_date TEXT NOT NULL DEFAULT '', order_source TEXT NOT NULL DEFAULT '',
              designer TEXT NOT NULL DEFAULT '', planner TEXT NOT NULL DEFAULT '', execution_company TEXT NOT NULL DEFAULT '',
              created_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT '已提交' CHECK(status IN ('已提交','已完成')),
              payment_status TEXT NOT NULL DEFAULT '未结款', note TEXT NOT NULL DEFAULT '', specification TEXT NOT NULL DEFAULT '',
              products_json TEXT NOT NULL DEFAULT '[]', costs_json TEXT NOT NULL DEFAULT '[]', is_extra INTEGER NOT NULL DEFAULT 0,
              idempotency_key TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by_uid INTEGER, designer_uid INTEGER, planner_uid INTEGER,
              FOREIGN KEY(customer_id) REFERENCES customer_profiles(id), FOREIGN KEY(project_id) REFERENCES projects_simple(id)
            );
            INSERT INTO orders_simple_v33(id,code,customer_id,project_id,service_name,quantity,unit,quote_amount,cost_amount,order_date,delivery_date,order_source,designer,planner,execution_company,created_by,status,payment_status,note,specification,products_json,costs_json,is_extra,idempotency_key,created_at,created_by_uid,designer_uid,planner_uid)
              SELECT id,code,customer_id,project_id,service_name,quantity,unit,quote_amount,cost_amount,order_date,delivery_date,order_source,designer,planner,execution_company,created_by,status,payment_status,note,specification,products_json,costs_json,is_extra,idempotency_key,created_at,created_by_uid,designer_uid,planner_uid FROM orders_simple;
            DROP TABLE orders_simple;
            ALTER TABLE orders_simple_v33 RENAME TO orders_simple;
            CREATE INDEX idx_simple_orders_date ON orders_simple(order_date DESC);
            CREATE INDEX idx_simple_orders_customer ON orders_simple(customer_id,project_id);
            CREATE UNIQUE INDEX idx_orders_idempotency ON orders_simple(idempotency_key) WHERE idempotency_key <> '';

            DROP TABLE IF EXISTS customers_simple;
            UPDATE schema_meta SET value='33' WHERE key='order_app_version';
          `);
        })();
      } finally {
        instance.pragma('foreign_keys = ON');
      }
      const v33Violations = instance.pragma('foreign_key_check') as Array<Record<string, unknown>>;
      if (v33Violations.length) throw new Error(`v33 迁移后存在 ${v33Violations.length} 条外键异常`);
    }
    // v34：个人垫付先生成“待上传证明”，员工补传付款截图和发票后再进入三级审核。
    // SQLite 不能直接修改 CHECK 约束，按旧版迁移方式重建报销表；关闭 legacy_alter_table
    // 会让附件/审批表的 REFERENCES 跟着旧表名改写，因此这里临时开启 legacy 模式。
    if (appVersion < 34) {
      const legacyAlterTable = instance.pragma('legacy_alter_table', { simple: true });
      instance.pragma('legacy_alter_table = ON');
      instance.pragma('foreign_keys = OFF');
      try {
        instance.transaction(() => {
          instance!.exec(`
            ALTER TABLE reimbursements_simple RENAME TO reimbursements_simple_v34;
            CREATE TABLE reimbursements_simple(
              id TEXT PRIMARY KEY, employee TEXT NOT NULL, item TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0,
              advance_date TEXT NOT NULL, order_id TEXT, invoice TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_proof','pending_review','pending_recheck','pending_confirmation','pending_payment','paid','rejected')),
              reject_reason TEXT NOT NULL DEFAULT '', reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at TEXT,
              reimbursed_by TEXT NOT NULL DEFAULT '', reimbursed_at TEXT, voucher_no TEXT NOT NULL DEFAULT '',
              voucher_created_at TEXT, voucher_archived_at TEXT, created_at TEXT NOT NULL, employee_uid INTEGER,
              department TEXT NOT NULL DEFAULT '', source_line_id TEXT NOT NULL DEFAULT '',
              amount_adjusted INTEGER NOT NULL DEFAULT 0, amount_change_note TEXT NOT NULL DEFAULT '',
              content_modified INTEGER NOT NULL DEFAULT 0, content_modified_at TEXT,
              FOREIGN KEY(order_id) REFERENCES orders_simple(id) ON DELETE CASCADE
            );
            INSERT INTO reimbursements_simple(id,employee,item,amount,advance_date,order_id,invoice,note,status,reject_reason,reviewed_by,reviewed_at,reimbursed_by,reimbursed_at,voucher_no,voucher_created_at,voucher_archived_at,created_at,employee_uid,department,source_line_id,amount_adjusted,amount_change_note,content_modified,content_modified_at)
              SELECT id,employee,item,amount,advance_date,order_id,invoice,note,status,reject_reason,reviewed_by,reviewed_at,reimbursed_by,reimbursed_at,voucher_no,voucher_created_at,voucher_archived_at,created_at,employee_uid,department,source_line_id,0,'',0,NULL FROM reimbursements_simple_v34;
            DROP TABLE reimbursements_simple_v34;
            -- 历史自动垫付如果尚未上传任何附件，也回到“待上传证明”，避免直接进入一级审核。
            UPDATE reimbursements_simple
              SET status='pending_proof'
              WHERE status='pending_review' AND source_line_id<>''
                AND NOT EXISTS (SELECT 1 FROM reimbursement_attachments ra WHERE ra.reimbursement_id=reimbursements_simple.id);
            CREATE INDEX idx_simple_reimbursements_date ON reimbursements_simple(advance_date DESC);
            CREATE INDEX idx_simple_reimbursements_order ON reimbursements_simple(order_id);
            CREATE UNIQUE INDEX idx_reimbursements_voucher_no ON reimbursements_simple(voucher_no) WHERE voucher_no <> '';
            CREATE UNIQUE INDEX IF NOT EXISTS idx_reimbursements_source_line ON reimbursements_simple(order_id,source_line_id) WHERE source_line_id <> '';
            UPDATE schema_meta SET value='34' WHERE key='order_app_version';
          `);
        })();
      } finally {
        instance.pragma('foreign_keys = ON');
        instance.pragma(`legacy_alter_table = ${legacyAlterTable ? 'ON' : 'OFF'}`);
      }
      const v34Violations = instance.pragma('foreign_key_check') as Array<Record<string, unknown>>;
      if (v34Violations.length) throw new Error(`v34 迁移后存在 ${v34Violations.length} 条外键异常`);
    }
    // v35：部门改为「设计/执行/商务/策划/财务/老板」，身份完全由部门决定；
    // 历史「管理员」身份并入老板，历史「内务」部门并入财务。
    if (appVersion < 35) {
      const legacyAlterTable = instance.pragma('legacy_alter_table', { simple: true });
      instance.pragma('legacy_alter_table = ON');
      instance.pragma('foreign_keys = OFF');
      try {
        instance.transaction(() => {
          instance!.exec(`
            ALTER TABLE employees RENAME TO employees_v35;
            CREATE TABLE employees (
              catsco_uid INTEGER PRIMARY KEY,
              username TEXT NOT NULL,
              display_name TEXT NOT NULL,
              department TEXT NOT NULL DEFAULT '',
              role TEXT NOT NULL DEFAULT 'pending' CHECK(role IN ('pending','executor','designer','business','planner','finance','owner')),
              active INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            INSERT INTO employees(catsco_uid,username,display_name,department,role,active,created_at,updated_at)
              SELECT catsco_uid,username,display_name,department,
                CASE department
                  WHEN '设计' THEN 'designer'
                  WHEN '执行' THEN 'executor'
                  WHEN '商务' THEN 'business'
                  WHEN '策划' THEN 'planner'
                  WHEN '财务' THEN 'finance'
                  WHEN '老板' THEN 'owner'
                  ELSE 'pending'
                END,
                CASE WHEN department='' THEN 0 ELSE 1 END,
                created_at,updated_at
              FROM (
                SELECT catsco_uid,username,display_name,
                  CASE
                    WHEN role='pending' THEN ''
                    WHEN role IN ('owner','manager') THEN '老板'
                    WHEN department='内务' THEN '财务'
                    WHEN department IN ('设计','执行','商务','策划','财务','老板') THEN department
                    WHEN role='executor' THEN '执行'
                    WHEN role='designer' THEN '设计'
                    WHEN role='planner' THEN '策划'
                    WHEN role='finance' THEN '财务'
                    ELSE ''
                  END AS department,
                  created_at,updated_at
                FROM employees_v35
              );
            DROP TABLE employees_v35;

            ALTER TABLE system_admin_identity RENAME TO system_admin_identity_v35;
            CREATE TABLE system_admin_identity (
              uid INTEGER PRIMARY KEY,
              role TEXT NOT NULL CHECK(role IN ('executor','designer','business','planner','finance','owner')),
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            INSERT INTO system_admin_identity(uid,role,created_at,updated_at)
              SELECT uid,CASE role WHEN 'manager' THEN 'owner' ELSE role END,created_at,updated_at
              FROM system_admin_identity_v35;
            DROP TABLE system_admin_identity_v35;

            -- 部门配置与报销部门快照跟随新部门：历史内务归入财务，空快照按员工当前部门补齐。
            UPDATE department_approvers SET department='财务' WHERE department='内务';
            UPDATE reimbursements_simple SET department='财务' WHERE department='内务';
            UPDATE reimbursements_simple
              SET department=COALESCE((SELECT department FROM employees WHERE employees.catsco_uid=reimbursements_simple.employee_uid),department)
              WHERE department='';
            UPDATE schema_meta SET value='35' WHERE key='order_app_version';
          `);
        })();
      } finally {
        instance.pragma('foreign_keys = ON');
        instance.pragma(`legacy_alter_table = ${legacyAlterTable ? 'ON' : 'OFF'}`);
      }
      const v35Violations = instance.pragma('foreign_key_check') as Array<Record<string, unknown>>;
      if (v35Violations.length) throw new Error(`v35 迁移后存在 ${v35Violations.length} 条外键异常`);
    }
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

/** 导入内置报价/成本样例：分别写入报价库和成本库，raw_data 保留原始行。 */
function importBundledExcel(db: Database.Database) {
  const dir = join(process.cwd(), 'excel');
  if (!existsSync(dir)) return;
  const files = ['【佛山广电集采价-AI测试版】2023年至2025年宣传广告活动资格标种类表报价表-广东省瑜鹏传媒科技有限公司(1).xls', '【供应商成本价-测试版】硕达2026年喷画结算价.xlsx'];
  const upsertQuote = db.prepare(`INSERT INTO catalog_quote_items(id,source_id,active,item_no,category,name,specification,unit,estimated_quantity,price_incl_tax,max_price,customer_name,project_name,remark,source_file,source_sheet,source_type,raw_data,created_at)
    VALUES(?,?,1,?,?,?,?,?,?,?,?,'','',?,?,?,?,?,?)
    ON CONFLICT(category,name,customer_name,project_name,specification,estimated_quantity) DO UPDATE SET source_id=excluded.source_id,active=1,item_no=excluded.item_no,unit=excluded.unit,price_incl_tax=excluded.price_incl_tax,max_price=excluded.max_price,remark=excluded.remark,source_file=excluded.source_file,source_sheet=excluded.source_sheet,source_type=excluded.source_type,raw_data=excluded.raw_data`);
  const upsertCost = db.prepare(`INSERT INTO catalog_cost_items(id,source_id,active,item_no,category,name,specification,unit,supplier_name,cost_unit,min_quantity,remark,source_file,source_sheet,source_type,raw_data,created_at)
    VALUES(?,?,1,?,?,?,?,?,?,?,'',?,?,?,?,?,?)
    ON CONFLICT(category,name,supplier_name,specification) DO UPDATE SET source_id=excluded.source_id,active=1,item_no=excluded.item_no,unit=excluded.unit,cost_unit=excluded.cost_unit,remark=excluded.remark,source_file=excluded.source_file,source_sheet=excluded.source_sheet,source_type=excluded.source_type,raw_data=excluded.raw_data`);
  const add = (row: Record<string, unknown>, meta: { file: string; sheet: string; type: string; no: string; category: string; sourceId: string; owner: string }) => {
    const name = text(row.name) || text(row.product_name);
    if (!name) return;
    const unit = text(row.unit) || '项';
    const specification = text(row.specification);
    const raw = JSON.stringify(row);
    if (meta.type === 'supplier_cost') {
      upsertCost.run(uuid(), meta.sourceId, meta.no, meta.category, name, specification, unit, meta.owner, Number(row.cost_unit || 0), text(row.supplier_remark), meta.file, meta.sheet, meta.type, raw, now());
    } else {
      upsertQuote.run(uuid(), meta.sourceId, meta.no, meta.category, name, specification, unit, text(row.estimated_quantity), Number(row.quote_unit || 0), Number(row.max_quote_unit || 0), text(row.supplier_remark), meta.file, meta.sheet, meta.type, raw, now());
    }
  };
  db.transaction(() => {
    for (const file of files) {
      const path = join(dir, file); if (!existsSync(path)) continue;
      const kind = file.endsWith('.xls') ? 'quote' : 'cost';
      const owner = kind === 'quote' ? '佛山广电客户报价' : '硕达厂商成本';
      let source = db.prepare('SELECT id FROM catalog_sources WHERE source_file=?').get(file) as { id: string } | undefined;
      if (!source) {
        const sourceId = uuid();
        const libraryName = file.replace(/\.[^.]+$/, '');
        db.prepare('INSERT OR IGNORE INTO catalog_sources(id,kind,owner_name,library_name,source_file,source_method,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)').run(sourceId, kind, owner, libraryName, file, 'bundled', now(), now());
        source = { id: sourceId };
      }
      if (kind === 'quote') ensureCustomerProfile(db, owner);
      const workbook = XLSX.read(readFileSync(path), { type: 'buffer' });
      for (const sheet of workbook.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], { header: 1, defval: '' });
        if (file.endsWith('.xls')) {
          let category = sheet, previousName = '';
          for (let i = 4; i < rows.length; i++) {
            const r = rows[i] || []; const no = text(r[0]);
            if (!no || !/^\d+$/.test(no)) { if (text(r[0])) category = text(r[0]).replace(/类$/, ''); continue; }
            const name = text(r[1]) || previousName; if (name) previousName = name;
            add({ name, unit: text(r[2]), estimated_quantity: r[3], specification: r[4], max_quote_unit: excelMoney(r[5]), quote_unit: excelMoney(r[6]) }, { file, sheet, type: 'customer_quote', no, category, sourceId: source.id, owner });
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
            add({ name, unit: r[1], cost_unit: excelMoney(r[2]), supplier_remark: r[3] }, { file, sheet, type: 'supplier_cost', no: String(i + 1), category: previousCategory, sourceId: source.id, owner });
          }
        }
      }
    }
  })();
}

// 订单可选的客户唯一来自「客户管理」（customer_profiles）。
// 报价库仍按 owner_name 归属客户；历史资料库或外部接口创建的新客户名会补一条最小客户档案，
// 但订单/项目保存的是客户档案 id，不再靠名称匹配。
const quoteLibraryPlaceholderOwners = new Set(['通用客户报价']);

function ensureCustomerProfile(db: Database.Database, name: string, contact = ''): string | null {
  const customerName = text(name);
  if (!customerName || quoteLibraryPlaceholderOwners.has(customerName)) return null;
  const existing = db.prepare('SELECT id FROM customer_profiles WHERE name=?').get(customerName) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = uuid();
  const timestamp = now();
  db.prepare(`INSERT INTO customer_profiles(id,name,tax_no,contact,phone,address,bank_name,bank_account,note,created_at,updated_at) VALUES(?,?,'',?,'','','','','',?,?)`)
    .run(id, customerName, text(contact), timestamp, timestamp);
  return id;
}

/** 兼容历史报价库：资料库 owner_name 还没有对应客户档案时补建，保证其客户可在订单中选择。 */
function syncQuoteLibraryCustomers(db: Database.Database) {
  const rows = db.prepare("SELECT DISTINCT owner_name FROM catalog_sources WHERE kind='quote' AND active=1").all() as Array<{ owner_name: string }>;
  if (!rows.length) return;
  db.transaction(() => { for (const row of rows) ensureCustomerProfile(db, row.owner_name); })();
}

export function listCustomers() {
  const db = getOrderDb();
  syncQuoteLibraryCustomers(db);
  // 订单页面只需要选择客户所需的最小字段，不把开票资料等客户档案详情下发到工作台。
  return db.prepare('SELECT id,name,contact FROM customer_profiles ORDER BY name').all();
}

export function listProjects(customerId?: string) {
  const db = getOrderDb();
  return customerId
    ? db.prepare('SELECT p.*, c.name AS customer_name FROM projects_simple p JOIN customer_profiles c ON c.id=p.customer_id WHERE p.customer_id=? ORDER BY p.name').all(customerId)
    : db.prepare('SELECT p.*, c.name AS customer_name FROM projects_simple p JOIN customer_profiles c ON c.id=p.customer_id ORDER BY c.name,p.name').all();
}

export function listCatalog() {
  // 显式列出网页需要的字段：报价库的 raw_data 是导入时的原始行快照（占响应体约 28%），
  // 网页只用 name/category/customer_name/project_name 等字段筛选，从不下发。
  // 成本库仍保留 raw_data：成本单价选择需要从 raw.vendor/raw.supplier 回退供应商名。
  const db = getOrderDb();
  const quote = db.prepare(`SELECT qi.id,qi.source_id,qi.active,qi.item_no,qi.category,qi.name,qi.specification,qi.unit,
      qi.estimated_quantity,qi.price_incl_tax,qi.max_price,qi.customer_name,qi.project_name,qi.remark,
      qi.source_file,qi.source_sheet,qi.source_type,qi.created_at,
      cs.kind AS library_kind,cs.owner_name AS source_owner,cs.library_name AS source_library,cs.source_file AS library_file,cs.updated_at AS source_updated_at
    FROM catalog_quote_items qi LEFT JOIN catalog_sources cs ON cs.id=qi.source_id
    WHERE qi.active=1 ORDER BY cs.owner_name,qi.category,qi.name`).all();
  const cost = db.prepare(`SELECT ki.*,cs.kind AS library_kind,cs.owner_name AS source_owner,cs.library_name AS source_library,cs.source_file AS library_file,cs.updated_at AS source_updated_at
    FROM catalog_cost_items ki LEFT JOIN catalog_sources cs ON cs.id=ki.source_id
    WHERE ki.active=1 ORDER BY cs.owner_name,ki.category,ki.name`).all();
  return { quote, cost };
}

export function listCatalogSources() {
  return getOrderDb().prepare(`SELECT cs.*,
      CASE cs.kind WHEN 'cost' THEN (SELECT COUNT(*) FROM catalog_cost_items ki WHERE ki.source_id=cs.id AND ki.active=1)
        ELSE (SELECT COUNT(*) FROM catalog_quote_items qi WHERE qi.source_id=cs.id AND qi.active=1) END AS item_count
    FROM catalog_sources cs ORDER BY cs.kind,cs.owner_name,cs.library_name,cs.updated_at DESC`).all();
}

export function createCatalogSource(data: Record<string, unknown>) {
  const kind = text(data.kind);
  const owner = text(data.owner_name);
  const copyFromId = text(data.copy_from_id);
  if (!['quote', 'cost'].includes(kind) || !owner) throw new Error('请填写有效的资料库类型和公司名称');
  const db = getOrderDb();
  const id = uuid();
  return db.transaction(() => {
    let copySource: Record<string, any> | undefined;
    let copyItems: Array<Record<string, any>> = [];
    if (copyFromId) {
      copySource = db.prepare('SELECT * FROM catalog_sources WHERE id=? AND kind=? AND active=1').get(copyFromId, kind) as Record<string, any> | undefined;
      if (!copySource) throw new Error('沿用的资料库不存在或类型不一致');
      const table = kind === 'cost' ? 'catalog_cost_items' : 'catalog_quote_items';
      copyItems = db.prepare(`SELECT * FROM ${table} WHERE source_id=? AND active=1 ORDER BY category,name`).all(copyFromId) as Array<Record<string, any>>;
      if (!copyItems.length) throw new Error('沿用的资料库暂无有效条目');
    }
    const createdAt = now();
    const sourceFile = text(data.source_file) || text(copySource?.source_file);
    const libraryName = text(data.library_name)
      || text(copySource?.library_name)
      || sourceFile.replace(/\.[^.]+$/, '')
      || owner;
    db.prepare('INSERT INTO catalog_sources(id,kind,owner_name,library_name,source_file,source_method,active,created_at,updated_at,import_summary_json) VALUES(?,?,?,?,?,?,1,?,?,?)')
      .run(id, kind, owner, libraryName, sourceFile, copyFromId ? 'copy' : text(data.source_method) || 'manual', createdAt, createdAt, JSON.stringify(copyFromId ? { copied_from: copyFromId, copied_items: copyItems.length, copied_at: createdAt } : {}));
    if (copyItems.length) {
      if (kind === 'cost') {
        const insertCost = db.prepare(`INSERT INTO catalog_cost_items(id,source_id,active,item_no,category,name,specification,unit,supplier_name,cost_unit,min_quantity,remark,source_file,source_sheet,source_type,raw_data,created_at)
          VALUES(@id,@sourceId,1,@itemNo,@category,@name,@specification,@unit,@supplierName,@cost,@minQuantity,@remark,@sourceFile,@sourceSheet,@sourceType,@raw,@createdAt)`);
        for (const item of copyItems) insertCost.run({ id: uuid(), sourceId: id, itemNo: item.item_no, category: item.category, name: item.name, specification: item.specification, unit: item.unit, supplierName: owner, cost: item.cost_unit, minQuantity: item.min_quantity, remark: item.remark, sourceFile: item.source_file, sourceSheet: item.source_sheet, sourceType: item.source_type, raw: item.raw_data, createdAt });
      } else {
        const insertQuote = db.prepare(`INSERT INTO catalog_quote_items(id,source_id,active,item_no,category,name,specification,unit,estimated_quantity,price_incl_tax,max_price,customer_name,project_name,remark,source_file,source_sheet,source_type,raw_data,created_at)
          VALUES(@id,@sourceId,1,@itemNo,@category,@name,@specification,@unit,@estimatedQuantity,@price,@maxPrice,@customerName,@projectName,@remark,@sourceFile,@sourceSheet,@sourceType,@raw,@createdAt)`);
        for (const item of copyItems) insertQuote.run({ id: uuid(), sourceId: id, itemNo: item.item_no, category: item.category, name: item.name, specification: item.specification, unit: item.unit, estimatedQuantity: item.estimated_quantity, price: item.price_incl_tax, maxPrice: item.max_price, customerName: owner, projectName: item.project_name, remark: item.remark, sourceFile: item.source_file, sourceSheet: item.source_sheet, sourceType: item.source_type, raw: item.raw_data, createdAt });
      }
    }
    // 客户报价库必须归属客户管理中的客户；缺失时补建最小档案，兼容外部接口和历史数据。
    if (kind === 'quote') ensureCustomerProfile(db, owner);
    return db.prepare(`SELECT cs.*, CASE cs.kind WHEN 'cost' THEN (SELECT COUNT(*) FROM catalog_cost_items ki WHERE ki.source_id=cs.id AND ki.active=1) ELSE (SELECT COUNT(*) FROM catalog_quote_items qi WHERE qi.source_id=cs.id AND qi.active=1) END AS item_count FROM catalog_sources cs WHERE cs.id=?`).get(id);
  })();
}

function parseList(value: unknown): Array<Record<string, unknown>> {
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : []; } catch { return []; }
}


function reimbursementStatusFor(advances: Array<Record<string, unknown>>): string {
  if (!advances.length) return '无需报销';
  if (advances.some((item) => reimbursementStatusCode(item.status) === 'pending_proof')) return reimbursementStatusLabel('pending_proof');
  if (advances.some((item) => reimbursementStatusCode(item.status) === 'pending_review')) return reimbursementStatusLabel('pending_review');
  if (advances.some((item) => reimbursementStatusCode(item.status) === 'rejected')) return reimbursementStatusLabel('rejected');
  if (advances.some((item) => reimbursementStatusCode(item.status) === 'pending_recheck')) return reimbursementStatusLabel('pending_recheck');
  if (advances.some((item) => reimbursementStatusCode(item.status) === 'pending_confirmation')) return reimbursementStatusLabel('pending_confirmation');
  if (advances.some((item) => reimbursementStatusCode(item.status) === 'pending_payment')) return reimbursementStatusLabel('pending_payment');
  return reimbursementStatusLabel('paid');
}

export type DepartmentApproverRow = {
  id: string;
  department: string;
  layer: number;
  employee_uid: number;
  display_name: string;
  username: string;
  role: string;
  active: number;
};
export type ReimbursementApprover = { employee_uid: number | null; display_name: string; username: string; role: string };
export type ReimbursementApprovalHistory = {
  id: string;
  layer: number;
  action: string;
  approver_uid: number | null;
  approver_name: string;
  comment: string;
  created_at: string;
};

const defaultApproverRoleLabels: Record<string, string> = {
  admin: '系统管理员',
  business: '商务',
  finance: '财务',
  owner: '老板'
};

function listDepartmentApproverRows(department?: string, layer?: number): DepartmentApproverRow[] {
  const filters: string[] = [];
  const args: Array<string | number> = [];
  if (department) { filters.push('da.department=?'); args.push(department); }
  if (layer) { filters.push('da.layer=?'); args.push(layer); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  return getOrderDb().prepare(`SELECT da.id,da.department,da.layer,da.employee_uid,
    COALESCE(NULLIF(e.display_name,''),NULLIF(e.username,''),CAST(da.employee_uid AS TEXT)) AS display_name,
    COALESCE(e.username,'') AS username,COALESCE(e.role,'') AS role,COALESCE(e.active,0) AS active
    FROM department_approvers da LEFT JOIN employees e ON e.catsco_uid=da.employee_uid
    ${where} ORDER BY da.department,da.layer,e.display_name`).all(...args) as DepartmentApproverRow[];
}

/** 一次读取全部部门配置，供报销列表批量补充当前审核人，避免逐行查询。 */
function departmentApproverBuckets() {
  const buckets = new Map<string, Map<number, ReimbursementApprover[]>>();
  for (const row of listDepartmentApproverRows()) {
    const layers = buckets.get(row.department) || new Map<number, ReimbursementApprover[]>();
    const approvers = layers.get(row.layer) || [];
    approvers.push({ employee_uid: row.employee_uid, display_name: row.display_name, username: row.username, role: row.role });
    layers.set(row.layer, approvers);
    buckets.set(row.department, layers);
  }
  return buckets;
}

type ReimbursementApproverRow = { status?: string; department?: string; employee?: string; employee_uid?: number | null };

/**
 * 审批使用的部门：优先沿用提交时的部门快照；历史记录快照缺失或已失效时，
 * 再按报销员工档案补全，避免明明配置了部门审核人却仍显示默认审核人。
 */
function approvalDepartmentForRow(row: ReimbursementApproverRow, buckets?: ReturnType<typeof departmentApproverBuckets>): string {
  const snapshot = text(row.department);
  const configured = buckets || departmentApproverBuckets();
  const known = snapshot && (configured.has(snapshot) || (departments as readonly string[]).includes(snapshot));
  if (known) return snapshot;
  const db = getOrderDb();
  const uid = Number.isSafeInteger(Number(row.employee_uid)) && Number(row.employee_uid) > 0
    ? Number(row.employee_uid)
    : resolveEmployeeUidByName(db, text(row.employee));
  return employeeDepartment(db, uid) || snapshot;
}

/** 报销内容权限等场景同样使用补全后的部门，保持展示与权限判断一致。 */
export function reimbursementApprovalDepartment(row: { department?: string; employee?: string; employee_uid?: number | null }): string {
  return approvalDepartmentForRow(row);
}

function approversForRow(row: ReimbursementApproverRow, buckets?: ReturnType<typeof departmentApproverBuckets>) {
  const context = buckets || departmentApproverBuckets();
  const department = approvalDepartmentForRow(row, context);
  const step = reimbursementStepForStatus(row.status);
  if (!step) return { step: null, approvers: [] as ReimbursementApprover[], usingDefault: false, department };
  const configured = context.get(department)?.get(step.layer) || [];
  if (configured.length) return { step, approvers: configured, usingDefault: false, department };
  // 部门尚未配置时按原有角色兜底，避免升级后旧流程立刻中断。
  const fallback = step.defaultRoles.map((role) => ({
    employee_uid: null,
    display_name: defaultApproverRoleLabels[role] || role,
    username: '',
    role
  }));
  return { step, approvers: fallback, usingDefault: true, department };
}

/** 当前身份是否负责该报销的当前节点。部门配置了审核人时，仅配置人员可处理。 */
export function canActOnReimbursement(
  row: { status: string; department?: string; employee_uid?: number | null },
  identity: { uid: number; role: string } | null | undefined,
  buckets?: ReturnType<typeof departmentApproverBuckets>
): boolean {
  if (!identity) return false;
  const step = reimbursementStepForStatus(row.status);
  if (!step) return false;
  if (row.employee_uid != null && Number(row.employee_uid) === identity.uid && !isAdminUid(identity.uid)) return false;
  if (step.layer === 4) return (step.defaultRoles as readonly string[]).includes(identity.role);
  const context = buckets || departmentApproverBuckets();
  const configured = context.get(approvalDepartmentForRow(row as ReimbursementApproverRow, context))?.get(step.layer) || [];
  if (configured.length) return configured.some((approver) => approver.employee_uid === identity.uid);
  return (step.defaultRoles as readonly string[]).includes(identity.role);
}

/** 给列表行附加当前节点审核人和前端可执行动作。 */
export function withReimbursementActions<T extends Record<string, any>>(
  rows: T[],
  identity: { uid: number; role: string } | null | undefined
): Array<T & { can_act: boolean; can_reject: boolean; next_status: string | null; next_action_label: string; reject_action_label: string }> {
  const buckets = departmentApproverBuckets();
  return rows.map((row) => {
    const step = reimbursementStepForStatus(row.status);
    const canAct = canActOnReimbursement(row as any, identity, buckets);
    const nextCode = canAct && step ? reimbursementNextCodeForLayer(step.layer) : null;
    return {
      ...row,
      can_act: canAct,
      can_reject: Boolean(canAct && step && step.layer < 4),
      next_status: nextCode ? reimbursementStatusLabel(nextCode) : null,
      next_action_label: step && canAct ? step.approveLabel : '',
      reject_action_label: step && canAct && step.layer < 4 ? step.rejectLabel : ''
    };
  });
}

/** 给报销行补充部门、当前审核节点、审核人和审批记录。 */
function withApprovalInfo<T extends Record<string, any>>(rows: T[]): T[] {
  const buckets = departmentApproverBuckets();
  const historyByReimbursement = new Map<string, ReimbursementApprovalHistory[]>();
  const history = getOrderDb().prepare(`SELECT id,reimbursement_id,layer,action,approver_uid,approver_name,comment,created_at
    FROM reimbursement_approvals ORDER BY created_at,id`).all() as Array<ReimbursementApprovalHistory & { reimbursement_id: string }>;
  for (const item of history) {
    const list = historyByReimbursement.get(item.reimbursement_id) || [];
    list.push(item);
    historyByReimbursement.set(item.reimbursement_id, list);
  }
  return rows.map((row) => {
    const { step, approvers, usingDefault, department } = approversForRow(row as any, buckets);
    return {
      ...row,
      department: department || text(row.department),
      approval_layer: step?.layer ?? null,
      current_approvers: approvers.map((approver) => ({ uid: approver.employee_uid, name: approver.display_name, role: approver.role })),
      using_default_approvers: usingDefault,
      approval_history: historyByReimbursement.get(String(row.id)) || []
    };
  });
}

export function isDepartmentApprover(uid: number, department?: string): boolean {
  const db = getOrderDb();
  return Boolean(department
    ? db.prepare('SELECT 1 FROM department_approvers WHERE employee_uid=? AND department=? LIMIT 1').get(uid, department)
    : db.prepare('SELECT 1 FROM department_approvers WHERE employee_uid=? LIMIT 1').get(uid));
}

export function listDepartmentApproverConfig() {
  const approvers: Record<string, Record<string, ReimbursementApprover[]>> = {};
  for (const department of departments) approvers[department] = { '1': [], '2': [], '3': [] };
  for (const row of listDepartmentApproverRows()) {
    approvers[row.department] ||= { '1': [], '2': [], '3': [] };
    approvers[row.department][String(row.layer)] ||= [];
    approvers[row.department][String(row.layer)].push({
      employee_uid: row.employee_uid,
      display_name: row.display_name,
      username: row.username,
      role: row.role
    });
  }
  return {
    departments: [...departments],
    layers: reimbursementWorkflow.slice(0, 3).map((step) => ({
      layer: step.layer,
      status: step.status,
      defaultRoles: [...step.defaultRoles]
    })),
    approvers
  };
}

export function setDepartmentApprovers(
  department: string,
  layers: Record<string, unknown>,
  actor: { name?: string; uid?: number | null } = {}
) {
  const targetDepartment = text(department);
  if (!departments.includes(targetDepartment as typeof departments[number])) throw new Error('INVALID_DEPARTMENT');
  const db = getOrderDb();
  const normalized: Array<{ layer: number; uid: number }> = [];
  for (const layer of [1, 2, 3]) {
    const values = Array.isArray((layers as any)[layer])
      ? (layers as any)[layer]
      : Array.isArray((layers as any)[String(layer)]) ? (layers as any)[String(layer)] : [];
    for (const value of values) {
      const uid = Number(value);
      if (!Number.isSafeInteger(uid) || uid <= 0) throw new Error('INVALID_APPROVER');
      if (!db.prepare('SELECT 1 FROM employees WHERE catsco_uid=?').get(uid)) throw new Error('APPROVER_NOT_FOUND');
      if (!normalized.some((item) => item.layer === layer && item.uid === uid)) normalized.push({ layer, uid });
    }
  }
  db.transaction(() => {
    db.prepare('DELETE FROM department_approvers WHERE department=?').run(targetDepartment);
    const insert = db.prepare('INSERT INTO department_approvers(id,department,layer,employee_uid,created_at) VALUES(?,?,?,?,?)');
    for (const item of normalized) insert.run(uuid(), targetDepartment, item.layer, item.uid, now());
    recordAudit(db, {
      actorName: actor.name || '',
      actorUid: actor.uid ?? null,
      action: 'update_department_approvers',
      entityType: 'department',
      entityId: targetDepartment,
      detail: { layers: { 1: normalized.filter((item) => item.layer === 1).map((item) => item.uid), 2: normalized.filter((item) => item.layer === 2).map((item) => item.uid), 3: normalized.filter((item) => item.layer === 3).map((item) => item.uid) } }
    });
  })();
  return listDepartmentApproverConfig();
}

function employeeDepartment(db: Database.Database, uid: number | null | undefined): string {
  if (!uid) return '';
  // 身份由部门决定，报销部门快照直接取员工当前所属部门。
  const row = db.prepare('SELECT department FROM employees WHERE catsco_uid=?').get(uid) as { department: string } | undefined;
  return text(row?.department);
}

function recordReimbursementApproval(
  db: Database.Database,
  reimbursementId: string,
  layer: number,
  action: string,
  actorName: string,
  actorUid: number | null,
  comment = ''
) {
  db.prepare('INSERT INTO reimbursement_approvals(id,reimbursement_id,layer,action,approver_uid,approver_name,comment,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(uuid(), reimbursementId, layer, action, actorUid, actorName, comment, now());
}

/** 订单垫付仍以姓名录入，按姓名唯一匹配在职员工后写回稳定的 UID 关联。 */
function resolveEmployeeUidByName(db: Database.Database, name: string): number | null {
  const value = text(name);
  if (!value) return null;
  const matches = db.prepare("SELECT catsco_uid FROM employees WHERE role<>'pending' AND (display_name=? OR username=?)").all(value, value) as Array<{ catsco_uid: number }>;
  return matches.length === 1 ? matches[0].catsco_uid : null;
}

function syncNormalizedOrderLines(db: Database.Database, orderId: string, products: Array<Record<string, unknown>>, costs: Array<Record<string, unknown>>): string[] {
  // 保留订单内已有行的 id：个人垫付报销用行 id 关联，编辑订单时不能因为重写明细而丢失关联。
  const existingLineIds = new Set((db.prepare('SELECT id FROM order_products WHERE order_id=?').all(orderId) as Array<{ id: string }>).map((row) => row.id));
  const usedLineIds = new Set<string>();
  const lineIds = products.map((item) => {
    const requested = text(item.line_id);
    const lineId = requested && existingLineIds.has(requested) && !usedLineIds.has(requested) ? requested : uuid();
    usedLineIds.add(lineId);
    return lineId;
  });
  db.prepare('DELETE FROM order_products WHERE order_id=?').run(orderId);
  db.prepare('DELETE FROM order_costs WHERE order_id=?').run(orderId);
  const productInsert = db.prepare('INSERT INTO order_products(id,order_id,position,catalog_item_id,name,specification,remark,unit,quantity,unit_price,subtotal) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  const costInsert = db.prepare('INSERT INTO order_costs(id,order_id,position,catalog_item_id,name,vendor,unit,quantity,unit_price,subtotal) VALUES(?,?,?,?,?,?,?,?,?,?)');
  products.forEach((item, index) => productInsert.run(lineIds[index], orderId, index, text(item.catalog_id) || null, text(item.name), text(item.specification), text(item.remark), text(item.unit) || '项', Number(item.quantity || 1), optionalMoneyToCents(item.unit_price), moneyToCents(lineTotalYuan(item))));
  // 成本单价允许由行成本合计反算（可能超过两位小数），入库时四舍五入到分，行小计仍按合计金额保存。
  costs.forEach((item, index) => costInsert.run(uuid(), orderId, index, text(item.catalog_id) || null, text(item.name), text(item.vendor), text(item.unit) || '项', Number(item.quantity || 1), Math.round(Number(item.unit_price || 0) * 100), moneyToCents(lineTotalYuan(item))));
  return lineIds;
}

type AdvanceActor = { name: string; uid: number | null };

/** 个人垫付的报销金额取该行成本合计（数量 × 成本单价）。 */
function advanceLineAmount(item: Record<string, unknown>): number {
  const quantity = Number(item.quantity);
  const costUnit = Number(item.cost_unit);
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(costUnit) || costUnit < 0) return 0;
  return Math.round(quantity * costUnit * 100);
}

function advanceItemName(item: Record<string, unknown>): string {
  const name = text(item.name) || '订单产品';
  const specification = text(item.specification).replace(/\s+/g, ' ').trim();
  return (specification ? `${name}（${specification}）` : name).slice(0, 200);
}

/**
 * 个人垫付：保存订单时按行同步报销记录。
 * 新记录先进入“待上传证明”，员工补传付款截图和发票后才会进入三级审核。
 * 上传证明前/待审核/已打回记录会跟随订单成本变化；取消垫付或删除行时，
 * 只清理尚未进入审核流程的记录，已审核/已付款的记录保留，避免影响财务流程。
 */
function syncOrderAdvanceReimbursements(
  db: Database.Database,
  order: { id: string; code: string; order_date: string },
  products: Array<Record<string, unknown>>,
  lineIds: string[],
  actor: AdvanceActor
) {
  const existing = db.prepare("SELECT id,source_line_id,status,amount_adjusted FROM reimbursements_simple WHERE order_id=? AND source_line_id<>''").all(order.id) as Array<{ id: string; source_line_id: string; status: string; amount_adjusted: number }>;
  const byLine = new Map(existing.map((row) => [row.source_line_id, row]));
  const kept = new Set<string>();
  const department = employeeDepartment(db, actor.uid);
  products.forEach((product, index) => {
    const lineId = lineIds[index];
    if (!lineId || !product.advance) return;
    const amount = advanceLineAmount(product);
    if (amount <= 0) throw new Error(`第 ${index + 1} 项已开启个人垫付，请填写成本`);
    const item = advanceItemName(product);
    const note = `订单 ${order.code} 个人垫付自动生成`;
    const row = byLine.get(lineId);
    if (!row) {
      if (!actor.name) throw new Error('个人垫付需要当前录入人身份');
      const id = uuid();
      db.prepare('INSERT INTO reimbursements_simple(id,employee,item,amount,advance_date,order_id,invoice,note,created_at,employee_uid,source_line_id,department,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, actor.name, item, amount, order.order_date, order.id, '', note, now(), actor.uid, lineId, department, 'pending_proof');
      recordAudit(db, { actorName: actor.name, actorUid: actor.uid, action: 'create_advance', entityType: 'reimbursement', entityId: id, detail: { order_id: order.id, order_code: order.code, amount, status: 'pending_proof' } });
    } else if (['pending_proof', 'pending_review', 'rejected'].includes(row.status)) {
      // 待上传证明且未申请过改金额时，金额跟随订单成本；已提交审核或已手动改金额后，
      // 订单成本变化不得覆盖报销金额，金额调整必须走“申请修改金额”并留下审批记录。
      if (row.status === 'pending_proof' && !row.amount_adjusted) {
        db.prepare("UPDATE reimbursements_simple SET amount=?,item=?,advance_date=?,note=?,department=CASE WHEN department='' THEN ? ELSE department END WHERE id=?")
          .run(amount, item, order.order_date, note, department, row.id);
      } else {
        db.prepare("UPDATE reimbursements_simple SET item=?,advance_date=?,note=?,department=CASE WHEN department='' THEN ? ELSE department END WHERE id=?")
          .run(item, order.order_date, note, department, row.id);
      }
    }
    kept.add(lineId);
  });
  for (const row of existing) {
    if (kept.has(row.source_line_id)) continue;
    if (!['pending_proof', 'pending_review', 'rejected'].includes(row.status)) continue;
    const files = db.prepare('SELECT storage_path FROM reimbursement_attachments WHERE reimbursement_id=?').all(row.id) as Array<{ storage_path: string }>;
    db.prepare('DELETE FROM reimbursements_simple WHERE id=?').run(row.id);
    for (const file of files) removeAttachmentFile(file.storage_path);
    recordAudit(db, { actorName: actor.name, actorUid: actor.uid, action: 'delete_advance', entityType: 'reimbursement', entityId: row.id, detail: { order_id: order.id, order_code: order.code } });
  }
}

function hydrateOrder(row: Record<string, unknown>): Record<string, any> {
  const db = getOrderDb();
  const normalizedProducts = db.prepare(`SELECT op.id AS line_id,op.catalog_item_id AS catalog_id,op.name,op.specification,op.remark,op.unit,op.quantity,op.unit_price / 100.0 AS unit_price,op.subtotal / 100.0 AS subtotal,qi.category
    FROM order_products op LEFT JOIN catalog_quote_items qi ON qi.id=op.catalog_item_id WHERE op.order_id=? ORDER BY op.position`).all(row.id) as Array<Record<string, unknown>>;
  const normalizedCosts = db.prepare('SELECT catalog_item_id AS catalog_id,name,vendor,unit,quantity,unit_price / 100.0 AS unit_price,subtotal / 100.0 AS subtotal FROM order_costs WHERE order_id=? ORDER BY position').all(row.id) as Array<Record<string, unknown>>;
  const products = normalizedProducts.length ? normalizedProducts : parseList(row.products_json);
  const costs = normalizedCosts.length ? normalizedCosts : parseList(row.costs_json);
  const advances = (db.prepare(`SELECT r.id,r.employee,r.item,r.amount / 100.0 AS amount,r.advance_date AS date,r.invoice,r.note,r.status,r.source_line_id,
    (SELECT ra.id FROM reimbursement_attachments ra WHERE ra.reimbursement_id=r.id ORDER BY ra.created_at DESC LIMIT 1) AS attachment_id,
    (SELECT COUNT(*) FROM reimbursement_attachments ra WHERE ra.reimbursement_id=r.id) AS attachment_count
    FROM reimbursements_simple r WHERE r.order_id=? ORDER BY r.advance_date,r.id`).all(row.id) as Array<Record<string, unknown>>).map((item) => ({ ...item, status: reimbursementStatusLabel(item.status) }));
  const employeeUids = [...new Set([row.created_by_uid, row.designer_uid, row.planner_uid]
    .map((uid) => Number(uid))
    .filter((uid) => Number.isSafeInteger(uid) && uid > 0))];
  const employeeNames = new Map<number, string>();
  if (employeeUids.length) {
    const rows = db.prepare(`SELECT catsco_uid,display_name FROM employees WHERE catsco_uid IN (${employeeUids.map(() => '?').join(',')})`).all(...employeeUids) as Array<{ catsco_uid: number; display_name: string }>;
    for (const employee of rows) employeeNames.set(employee.catsco_uid, employee.display_name);
  }
  // 订单里保存的是姓名快照，展示时优先按 UID 读取员工档案的最新姓名，
  // 这样员工改名后历史订单（以及旧数据中的用户名）都会显示为当前设置的员工姓名。
  const displayName = (uid: unknown, fallback: unknown) => {
    const value = Number(uid);
    return (Number.isSafeInteger(value) ? employeeNames.get(value) : '') || text(fallback);
  };
  // 订单行是否处于个人垫付以自动报销记录为准，刷新/再次编辑时仍能正确回显开关。
  const advanceLineIds = new Set(advances.map((item) => text((item as Record<string, unknown>).source_line_id)).filter(Boolean));
  const hydratedProducts = products.map((item) => ({ ...item, advance: advanceLineIds.has(text(item.line_id)) }));
  return {
    ...row,
    created_by: displayName(row.created_by_uid, row.created_by),
    designer: displayName(row.designer_uid, row.designer),
    planner: displayName(row.planner_uid, row.planner),
    status: normalizeOrderStatus(row.status), products: hydratedProducts, costs, advances,
    reimbursement_status: reimbursementStatusFor(advances)
  };
}

export function getOrderAccessInfo(id: string) {
  return getOrderDb().prepare('SELECT id,created_by,designer,planner,created_by_uid,designer_uid,planner_uid,status,payment_status FROM orders_simple WHERE id=?').get(id) as { id: string; created_by: string; designer: string; planner: string; created_by_uid: number | null; designer_uid: number | null; planner_uid: number | null; status: string; payment_status: string } | undefined;
}

/** 将订单标记为已完成并写入审计。重复调用幂等。 */
export function markOrderCompleted(id: string, actor: { name?: string; uid?: number | null } = {}) {
  const db = getOrderDb();
  const order = db.prepare('SELECT id,status FROM orders_simple WHERE id=?').get(id) as { id: string; status: string } | undefined;
  if (!order) throw new Error('ORDER_NOT_FOUND');
  const from = normalizeOrderStatus(order.status);
  if (from === '已完成') return { id, status: '已完成' as const };
  db.prepare("UPDATE orders_simple SET status='已完成' WHERE id=?").run(id);
  recordAudit(db, { actorName: actor.name || '', actorUid: actor.uid ?? null, action: 'complete', entityType: 'order', entityId: id, fromValue: from, toValue: '已完成' });
  return { id, status: '已完成' as const };
}

/** 更新订单结款状态（已结款 / 未结款），仅管理身份可调用。 */
export function setOrderPaymentStatus(id: string, status: string, actor: { name?: string; uid?: number | null } = {}) {
  const db = getOrderDb();
  const order = db.prepare('SELECT id,payment_status FROM orders_simple WHERE id=?').get(id) as { id: string; payment_status: string } | undefined;
  if (!order) throw new Error('ORDER_NOT_FOUND');
  const normalized = status === '已结款' ? '已结款' : '未结款';
  const current = order.payment_status || '未结款';
  if (current === normalized) return { id, payment_status: normalized };
  db.prepare('UPDATE orders_simple SET payment_status=? WHERE id=?').run(normalized, id);
  recordAudit(db, { actorName: actor.name || '', actorUid: actor.uid ?? null, action: 'update_payment', entityType: 'order', entityId: id, fromValue: current, toValue: normalized });
  return { id, payment_status: normalized };
}

/**
 * 校验并解析订单设计师/策划人的 UID。调用方应在写入订单之前执行，
 * 这样无效 UID 不会在订单提交后才抛错，造成部分写入。
 */
export function resolveOrderEmployeeUid(uid: unknown, role: 'designer' | 'planner'): number | null {
  const value = Number(uid) || null;
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`INVALID_${role.toUpperCase()}_UID`);
  const employee = getOrderDb().prepare("SELECT catsco_uid FROM employees WHERE catsco_uid=? AND role<>'pending' AND role=?").get(value, role);
  if (!employee) throw new Error(`INVALID_${role.toUpperCase()}_UID`);
  return value;
}

/** 只写入已解析的 UID；姓名仍由订单表保存为展示文本。 */
export function setOrderEmployees(id: string, creatorUid: number, designerUid: number | null, plannerUid: number | null) {
  getOrderDb().prepare('UPDATE orders_simple SET created_by_uid=?,designer_uid=?,planner_uid=? WHERE id=?')
    .run(creatorUid, designerUid, plannerUid, id);
}

export function canEmployeeAccessOrder(id: string, uid: number): boolean {
  return Boolean(getOrderDb().prepare('SELECT 1 FROM orders_simple WHERE id=? AND (created_by_uid=? OR designer_uid=? OR planner_uid=?)').get(id, uid, uid, uid));
}

/** 按 ID 读取完整订单；调用方必须先进行行级权限检查。 */
export function getOrderById(id: string): Record<string, any> | undefined {
  const row = getOrderDb().prepare(`SELECT o.*,c.name AS customer_name,p.name AS project_name
    FROM orders_simple o JOIN customer_profiles c ON c.id=o.customer_id JOIN projects_simple p ON p.id=o.project_id WHERE o.id=?`).get(id) as Record<string, unknown> | undefined;
  return row ? hydrateOrder(row) : undefined;
}

export function listOrders(): Array<Record<string, any>> {
  const rows = getOrderDb().prepare(`SELECT o.*, c.name AS customer_name, c.contact AS customer_contact, p.name AS project_name, p.owner AS project_owner FROM orders_simple o JOIN customer_profiles c ON c.id=o.customer_id JOIN projects_simple p ON p.id=o.project_id ORDER BY o.order_date DESC,o.created_at DESC`).all() as Array<Record<string, unknown>>;
  return rows.map(hydrateOrder);
}

export type ExecutionCompany = { id: string; name: string; sort_order: number; created_at: string; updated_at: string };
type ExecutionCompanyActor = { name?: string; uid?: number | null };

export function listExecutionCompanies(): ExecutionCompany[] {
  return getOrderDb().prepare('SELECT id,name,sort_order,created_at,updated_at FROM execution_companies ORDER BY sort_order,name').all() as ExecutionCompany[];
}

export function createExecutionCompany(name: unknown, actor?: ExecutionCompanyActor): ExecutionCompany {
  const value = text(name);
  if (!value) throw new Error('执行公司名称不能为空');
  if (value.length > 60) throw new Error('执行公司名称不能超过 60 个字符');
  const db = getOrderDb();
  if (db.prepare('SELECT 1 FROM execution_companies WHERE name=?').get(value)) throw new Error('该执行公司已存在');
  const id = uuid();
  const timestamp = now();
  const maxOrder = (db.prepare('SELECT COALESCE(MAX(sort_order),-1) AS value FROM execution_companies').get() as { value: number }).value;
  db.prepare('INSERT INTO execution_companies(id,name,sort_order,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, value, maxOrder + 1, timestamp, timestamp);
  recordAudit(db, { actorName: actor?.name, actorUid: actor?.uid, action: 'create_execution_company', entityType: 'execution_company', entityId: id, detail: { name: value } });
  return db.prepare('SELECT id,name,sort_order,created_at,updated_at FROM execution_companies WHERE id=?').get(id) as ExecutionCompany;
}

export function updateExecutionCompany(id: unknown, name: unknown, actor?: ExecutionCompanyActor): ExecutionCompany {
  const targetId = text(id);
  const value = text(name);
  if (!targetId) throw new Error('执行公司不存在');
  if (!value) throw new Error('执行公司名称不能为空');
  if (value.length > 60) throw new Error('执行公司名称不能超过 60 个字符');
  const db = getOrderDb();
  const existing = db.prepare('SELECT id,name FROM execution_companies WHERE id=?').get(targetId) as { id: string; name: string } | undefined;
  if (!existing) throw new Error('执行公司不存在');
  if (db.prepare('SELECT 1 FROM execution_companies WHERE name=? AND id<>?').get(value, targetId)) throw new Error('该执行公司已存在');
  db.prepare('UPDATE execution_companies SET name=?,updated_at=? WHERE id=?').run(value, now(), targetId);
  recordAudit(db, { actorName: actor?.name, actorUid: actor?.uid, action: 'update_execution_company', entityType: 'execution_company', entityId: targetId, fromValue: existing.name, toValue: value, detail: { name: value } });
  return db.prepare('SELECT id,name,sort_order,created_at,updated_at FROM execution_companies WHERE id=?').get(targetId) as ExecutionCompany;
}

export function deleteExecutionCompany(id: unknown, actor?: ExecutionCompanyActor) {
  const targetId = text(id);
  if (!targetId) throw new Error('执行公司不存在');
  const db = getOrderDb();
  const existing = db.prepare('SELECT id,name FROM execution_companies WHERE id=?').get(targetId) as { id: string; name: string } | undefined;
  if (!existing) throw new Error('执行公司不存在');
  db.prepare('DELETE FROM execution_companies WHERE id=?').run(targetId);
  recordAudit(db, { actorName: actor?.name, actorUid: actor?.uid, action: 'delete_execution_company', entityType: 'execution_company', entityId: targetId, detail: { name: existing.name } });
  return { id: targetId };
}

export type CustomerProfile = {
  id: string; name: string; tax_no: string; contact: string; phone: string;
  address: string; bank_name: string; bank_account: string; note: string;
  created_at: string; updated_at: string;
};
type CustomerProfileActor = { name?: string; uid?: number | null };

// 客户管理是订单客户的唯一来源；订单与项目通过 customer_id 直接引用客户档案，
// 客户改名后历史订单/项目展示自动跟随，不再按名称匹配订单归属。
function customerProfileValues(data: Record<string, unknown>) {
  const name = text(data.name);
  if (!name) throw new Error('客户名称不能为空');
  if (name.length > 80) throw new Error('客户名称不能超过 80 个字符');
  return {
    name,
    tax_no: text(data.tax_no).slice(0, 40),
    contact: text(data.contact).slice(0, 40),
    phone: text(data.phone).slice(0, 40),
    address: text(data.address).slice(0, 160),
    bank_name: text(data.bank_name).slice(0, 80),
    bank_account: text(data.bank_account).slice(0, 60),
    note: text(data.note).slice(0, 300),
  };
}

export function listCustomerProfiles(): CustomerProfile[] {
  return getOrderDb().prepare('SELECT * FROM customer_profiles ORDER BY name').all() as CustomerProfile[];
}

export function createCustomerProfile(data: Record<string, unknown>, actor?: CustomerProfileActor): CustomerProfile {
  const values = customerProfileValues(data);
  const db = getOrderDb();
  if (db.prepare('SELECT 1 FROM customer_profiles WHERE name=?').get(values.name)) throw new Error('该客户已存在');
  const id = uuid();
  const timestamp = now();
  db.prepare('INSERT INTO customer_profiles(id,name,tax_no,contact,phone,address,bank_name,bank_account,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, values.name, values.tax_no, values.contact, values.phone, values.address, values.bank_name, values.bank_account, values.note, timestamp, timestamp);
  recordAudit(db, { actorName: actor?.name, actorUid: actor?.uid, action: 'create_customer_profile', entityType: 'customer_profile', entityId: id, detail: { name: values.name } });
  return db.prepare('SELECT * FROM customer_profiles WHERE id=?').get(id) as CustomerProfile;
}

export function updateCustomerProfile(id: unknown, data: Record<string, unknown>, actor?: CustomerProfileActor): CustomerProfile {
  const targetId = text(id);
  if (!targetId) throw new Error('客户不存在');
  const values = customerProfileValues(data);
  const db = getOrderDb();
  const existing = db.prepare('SELECT * FROM customer_profiles WHERE id=?').get(targetId) as CustomerProfile | undefined;
  if (!existing) throw new Error('客户不存在');
  if (db.prepare('SELECT 1 FROM customer_profiles WHERE name=? AND id<>?').get(values.name, targetId)) throw new Error('该客户已存在');
  db.transaction(() => {
    db.prepare('UPDATE customer_profiles SET name=?,tax_no=?,contact=?,phone=?,address=?,bank_name=?,bank_account=?,note=?,updated_at=? WHERE id=?')
      .run(values.name, values.tax_no, values.contact, values.phone, values.address, values.bank_name, values.bank_account, values.note, now(), targetId);
    // 报价库按客户名称归属；客户改名时同步来源归属和报价条目快照，避免出现重复客户分组或旧名称匹配失效。
    if (existing.name !== values.name) {
      db.prepare("UPDATE catalog_sources SET owner_name=? WHERE kind='quote' AND owner_name=?").run(values.name, existing.name);
      db.prepare('UPDATE catalog_quote_items SET customer_name=? WHERE customer_name=?').run(values.name, existing.name);
    }
    recordAudit(db, { actorName: actor?.name, actorUid: actor?.uid, action: 'update_customer_profile', entityType: 'customer_profile', entityId: targetId, fromValue: existing.name, toValue: values.name, detail: { name: values.name } });
  })();
  return db.prepare('SELECT * FROM customer_profiles WHERE id=?').get(targetId) as CustomerProfile;
}

export function deleteCustomerProfile(id: unknown, actor?: CustomerProfileActor) {
  const targetId = text(id);
  if (!targetId) throw new Error('客户不存在');
  const db = getOrderDb();
  const existing = db.prepare('SELECT id,name FROM customer_profiles WHERE id=?').get(targetId) as { id: string; name: string } | undefined;
  if (!existing) throw new Error('客户不存在');
  const usage = db.prepare(`SELECT
      (SELECT COUNT(*) FROM orders_simple WHERE customer_id=?) AS orders,
      (SELECT COUNT(*) FROM projects_simple WHERE customer_id=?) AS projects,
      (SELECT COUNT(*) FROM catalog_sources WHERE kind='quote' AND owner_name=?) AS sources`)
    .get(targetId, targetId, existing.name) as { orders: number; projects: number; sources: number };
  if (usage.orders || usage.projects || usage.sources) throw new Error('该客户已有订单、项目或报价库，不能删除');
  db.prepare('DELETE FROM customer_profiles WHERE id=?').run(targetId);
  recordAudit(db, { actorName: actor?.name, actorUid: actor?.uid, action: 'delete_customer_profile', entityType: 'customer_profile', entityId: targetId, detail: { name: existing.name } });
  return { id: targetId };
}

const exportColumnLabels: Record<string, string> = {
  code: '订单编号', order_date: '订单日期', customer_name: '客户', project_name: '项目',
  project_owner: '项目负责人', order_source: '订单来源', designer: '设计师', planner: '策划人',
  delivery_date: '交货日期', payment_status: '结款状态', service_name: '订单内容', quantity: '数量', unit: '单位',
  quote_amount: '总报价', cost_amount: '制作成本', advance_amount: '报销金额', profit: '预计毛利', created_by: '录入人',
  status: '订单状态', reimbursement_status: '报销状态', product_name: '产品名称', product_specification: '制作要求', product_remark: '行备注',
  product_quantity: '产品数量', product_unit: '产品单位', product_unit_price: '产品单价', product_subtotal: '产品小计', note: '备注',
};

export function exportOrders(filters: Record<string, string>) {
  const selectedIds = new Set((filters.ids || '').split(',').map((id) => id.trim()).filter(Boolean));
  // customer_department / contact 已在 v29 合并为 order_source；旧导出链接里的字段名继续按订单来源出列。
  const legacyColumnAliases: Record<string, string> = { customer_department: 'order_source', contact: 'order_source' };
  const columns = (filters.columns || '')
    .split(',')
    .map((key) => legacyColumnAliases[key] || key)
    .filter((key, index, all) => exportColumnLabels[key] && all.indexOf(key) === index);
  const selectedColumns = columns.length ? columns : ['code', 'order_date', 'customer_name', 'project_name', 'service_name', 'quote_amount', 'cost_amount'];
  const orders = listOrders().filter((order) =>
    (!selectedIds.size || selectedIds.has(order.id)) &&
    (!filters.customer || order.customer_id === filters.customer) &&
    (!filters.project || order.project_id === filters.project) &&
    (!filters.owner || order.project_owner === filters.owner) &&
    (!filters.creator || order.created_by === filters.creator) &&
    (!filters.from || order.order_date >= filters.from) &&
    (!filters.to || order.order_date <= filters.to),
  );
  if (filters.mode === 'settlement') {
    const title = text(filters.title) || '订单结算明细';
    const partyA = text(filters.partyA) || '—';
    const partyB = text(filters.partyB) || '—';
    const detailRows: unknown[][] = [
      [title],
      [`甲方：${partyA}`],
      [`乙方：${partyB}`],
      [`合同编号：${text(filters.contract) || '—'}`],
      [`甲方项目跟进人：${text(filters.followA) || '—'}`],
      [`乙方项目跟进人：${text(filters.followB) || '—'}   联系电话：${text(filters.contactPhone) || '—'}`],
      ['序号', '产品名称', '单位', '数量', '规格和技术要求', '单价(元）', '小计（元）', '备注', ''],
    ];
    const categories = new Map<string, Array<Record<string, any>>>();
    for (const order of orders) {
      const products = order.products?.length ? order.products : [{ name: order.service_name, specification: order.specification, unit: order.unit, quantity: order.quantity, unit_price: order.quote_amount / 100 }];
      for (const product of products as Array<Record<string, any>>) {
        const category = String(product.category || order.catalog_category || '其他类');
        const rows = categories.get(category) || [];
        const note = text(order.note);
        // 行备注优先；未填时回退到订单备注，保证历史订单导出口径不变。
        const lineRemark = text(product.remark);
        rows.push({
          name: product.name || order.service_name,
          unit: product.unit || order.unit || '项',
          // 数量按整数展示：整数时不出现小数点，确有小数时保留小数。
          quantity: Number(product.quantity || 0),
          specification: product.specification || order.specification || '',
          unitPrice: Number(product.unit_price || 0),
          // 勾选“备注含订单编号”时在备注后附上订单号。
          remark: lineRemark || (filters.remarkOrder === 'true' ? (note ? `${note}（${order.code}）` : order.code) : note),
        });
        categories.set(category, rows);
      }
    }

    const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
    for (let row = 0; row < 6; row++) merges.push({ s: { r: row, c: 0 }, e: { r: row, c: 8 } });
    merges.push({ s: { r: 6, c: 7 }, e: { r: 6, c: 8 } });
    const subtotalRows: number[] = [];
    const chineseNumbers = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    let grandTotal = 0;
    let categoryIndex = 0;
    // 所有分类的明细共用同一个序号，保证序号连续且为整数。
    let serialNumber = 0;
    for (const [category, rows] of categories) {
      const categoryRow = detailRows.length;
      detailRows.push([`${chineseNumbers[categoryIndex] || categoryIndex + 1}、${category}`]);
      merges.push({ s: { r: categoryRow, c: 0 }, e: { r: categoryRow, c: 8 } });
      const detailStart = detailRows.length;
      rows.forEach((item) => {
        const subtotal = item.quantity * item.unitPrice;
        grandTotal += subtotal;
        serialNumber += 1;
        detailRows.push([serialNumber, item.name, item.unit, item.quantity, item.specification, item.unitPrice, subtotal, item.remark, '']);
        const row = detailRows.length - 1;
        merges.push({ s: { r: row, c: 7 }, e: { r: row, c: 8 } });
      });
      const subtotalRow = detailRows.length;
      detailRows.push(['小计', '', '', '', '', '', rows.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0), '', '']);
      merges.push({ s: { r: subtotalRow, c: 0 }, e: { r: subtotalRow, c: 5 } });
      merges.push({ s: { r: subtotalRow, c: 7 }, e: { r: subtotalRow, c: 8 } });
      subtotalRows.push(subtotalRow);
      categoryIndex++;
      if (detailStart === detailRows.length) detailRows.push([]);
    }

    const totalRow = detailRows.length;
    if (filters.total !== 'false') {
      detailRows.push(['总计（元）', '', '', '', '', '', grandTotal, '', '']);
      merges.push({ s: { r: totalRow, c: 0 }, e: { r: totalRow, c: 5 } });
      merges.push({ s: { r: totalRow, c: 6 }, e: { r: totalRow, c: 8 } });
    }
    const signatureStart = detailRows.length;
    if (filters.sign === 'true') {
      detailRows.push([`甲  方：${partyA}`, '', '', '', '', `乙  方：${partyB}`]);
      detailRows.push(['经办人：', '', '', '', '', '盖  章：']);
      detailRows.push(['部门负责人：']);
      detailRows.push(['盖  章：']);
      for (let row = signatureStart; row < detailRows.length; row++) {
        merges.push({ s: { r: row, c: 0 }, e: { r: row, c: 4 } });
        merges.push({ s: { r: row, c: 5 }, e: { r: row, c: 8 } });
      }
    }

    const sheet = XLSXStyle.utils.aoa_to_sheet(detailRows) as any;
    const titleFontName = '宋体';
    const bodyFontName = '仿宋_GB2312';
    const thin = { style: 'thin', color: { rgb: '000000' } };
    const border = { top: thin, bottom: thin, left: thin, right: thin };
    const ensureCell = (row: number, column: number) => {
      const address = XLSXStyle.utils.encode_cell({ r: row, c: column });
      if (!sheet[address]) sheet[address] = { t: 's', v: '' };
      return sheet[address];
    };
    const applyRowStyle = (row: number, style: Record<string, unknown>) => {
      for (let column = 0; column <= 8; column++) ensureCell(row, column).s = style;
    };
    const tableStyle = {
      font: { name: bodyFontName, sz: 18 },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border,
    };
    const rowHeights = detailRows.map(() => ({ hpt: 27.5 }));

    // Match excel/结算表.xls: title in 宋体 36pt, all other content in
    // 仿宋_GB2312 18pt, with the same monochrome bordered table structure.
    for (let row = 0; row < detailRows.length; row++) applyRowStyle(row, tableStyle);
    applyRowStyle(0, {
      font: { name: titleFontName, sz: 36 },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border,
    });
    rowHeights[0] = { hpt: 45.5 };
    for (let row = 1; row <= 5; row++) {
      applyRowStyle(row, {
        font: { name: bodyFontName, sz: 18 },
        alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
        border,
      });
      rowHeights[row] = { hpt: 27.5 };
    }
    applyRowStyle(6, {
      font: { name: bodyFontName, sz: 18 },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border,
    });
    rowHeights[6] = { hpt: 46 };

    let cursor = 7;
    for (const rows of categories.values()) {
      applyRowStyle(cursor, {
        font: { name: bodyFontName, sz: 18 },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border,
      });
      rowHeights[cursor] = { hpt: 27.5 };
      cursor++;
      for (const item of rows) {
        applyRowStyle(cursor, tableStyle);
        const nameLines = Math.ceil(String(item.name || '').length / 18);
        const specificationLines = Math.ceil(String(item.specification || '').length / 42);
        const remarkLines = Math.ceil(String(item.remark || '').length / 18);
        const visualLines = Math.max(2, nameLines, specificationLines, remarkLines);
        rowHeights[cursor] = { hpt: Math.min(117, Math.max(91, visualLines * 23)) };
        // 数量列用常规格式，整数直接显示为 3，而不是带小数点的 3.。
        ensureCell(cursor, 0).z = '0';
        ensureCell(cursor, 3).z = 'General';
        ensureCell(cursor, 5).z = '0.00;[Red](0.00)';
        ensureCell(cursor, 6).z = '0.00;[Red](0.00)';
        cursor++;
      }
      applyRowStyle(cursor, {
        font: { name: bodyFontName, sz: 18 },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border,
      });
      const detailStartExcel = cursor - rows.length + 1;
      ensureCell(cursor, 6).f = `SUM(G${detailStartExcel}:G${cursor})`;
      ensureCell(cursor, 6).z = '0.00;[Red](0.00)';
      rowHeights[cursor] = { hpt: 27.5 };
      cursor++;
    }
    if (filters.total !== 'false') {
      applyRowStyle(totalRow, {
        font: { name: bodyFontName, sz: 18 },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border,
      });
      ensureCell(totalRow, 6).f = subtotalRows.length ? subtotalRows.map((row) => `G${row + 1}`).join('+') : '0';
      ensureCell(totalRow, 6).z = '0.00;[Red](0.00)';
      rowHeights[totalRow] = { hpt: 27.5 };
    }
    if (filters.sign === 'true') {
      for (let row = signatureStart; row < detailRows.length; row++) {
        applyRowStyle(row, {
          font: { name: bodyFontName, sz: 18 },
          alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
          border,
        });
        rowHeights[row] = { hpt: 27.5 };
      }
    }

    sheet['!merges'] = merges;
    sheet['!cols'] = [
      { wch: 13.18 }, { wch: 28.80 }, { wch: 12.50 },
      { wch: 12.93 }, { wch: 81.07 }, { wch: 15.59 },
      { wch: 16.02 }, { wch: 19.66 }, { wch: 36.66 },
    ];
    sheet['!rows'] = rowHeights;
    sheet['!margins'] = { left: 0.4326, right: 0.275, top: 0.866, bottom: 0.118, header: 0.51, footer: 0.157 };
    sheet['!pageSetup'] = { orientation: 'portrait', fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    const workbook = XLSXStyle.utils.book_new();
    XLSXStyle.utils.book_append_sheet(workbook, sheet, '结算');
    (workbook as any).Workbook = { Names: [{ Name: 'Print_Area', Ref: `结算!$A$1:$I$${detailRows.length}`, Sheet: 0 }] };
    const rawWorkbook = XLSXStyle.write(workbook, { type: 'buffer', bookType: 'xlsx', cellStyles: true }) as Buffer;
    const archive = unzipSync(rawWorkbook);
    const worksheetPath = 'xl/worksheets/sheet1.xml';
    let worksheetXml = strFromU8(archive[worksheetPath]);
    if (!worksheetXml.includes('<pageSetUpPr')) {
      if (/<sheetPr[^>]*\/>/.test(worksheetXml)) worksheetXml = worksheetXml.replace(/<sheetPr([^>]*)\/>/, '<sheetPr$1><pageSetUpPr fitToPage="1"/></sheetPr>');
      else if (worksheetXml.includes('<sheetPr')) worksheetXml = worksheetXml.replace(/<sheetPr([^>]*)>/, '<sheetPr$1><pageSetUpPr fitToPage="1"/>');
      else worksheetXml = worksheetXml.replace(/(<worksheet[^>]*>)/, '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
    }
    if (!worksheetXml.includes('<pageSetup')) {
      const pageSetup = '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>';
      worksheetXml = worksheetXml.includes('<pageMargins')
        ? worksheetXml.replace(/(<pageMargins[^>]*\/>)/, `$1${pageSetup}`)
        : worksheetXml.replace('</worksheet>', `${pageSetup}</worksheet>`);
    }
    archive[worksheetPath] = strToU8(worksheetXml);
    return { data: Buffer.from(zipSync(archive, { level: 6 })), count: orders.length };
  }
  const expandProducts = filters.expand !== 'false';
  const rows = orders.flatMap((order) => {
    const advances = (order.advances || []).reduce((sum: number, item: any) => sum + Math.round(Number(item.amount || 0) * 100), 0);
    const products = order.products?.length ? order.products : [];
    const productsToWrite = expandProducts && products.length ? products : [null];
    return productsToWrite.map((product: any) => {
      const values: Record<string, unknown> = {
        code: order.code, order_date: order.order_date, customer_name: order.customer_name, project_name: order.project_name,
        project_owner: order.project_owner || '', order_source: order.order_source || '', designer: order.designer || '', planner: order.planner || '',
        delivery_date: order.delivery_date || '', payment_status: order.payment_status || '未结款',
        service_name: order.service_name, quantity: order.quantity, unit: order.unit, quote_amount: order.quote_amount / 100,
        cost_amount: order.cost_amount / 100, advance_amount: advances / 100, profit: (order.quote_amount - order.cost_amount - advances) / 100,
        created_by: order.created_by, status: order.status, reimbursement_status: order.reimbursement_status || '无需报销',
        product_name: product?.name || products.map((item: any) => item.name).join('、'),
        product_specification: product?.specification || products.map((item: any) => item.specification).filter(Boolean).join('；'),
        product_remark: product?.remark || products.map((item: any) => item.remark).filter(Boolean).join('；'),
        product_quantity: product?.quantity ?? products.map((item: any) => item.quantity).join('、'),
        product_unit: product?.unit || products.map((item: any) => item.unit).join('、'),
        product_unit_price: product ? Number(product.unit_price || 0) : products.map((item: any) => item.unit_price).join('、'),
        product_subtotal: product ? Number(product.quantity || 0) * Number(product.unit_price || 0) : order.quote_amount / 100,
        note: order.note || '',
      };
      return Object.fromEntries(selectedColumns.map((key) => [exportColumnLabels[key], values[key]]));
    });
  });
  const dataRowCount = rows.length;
  if (filters.total !== 'false' && selectedColumns.length) {
    const totalRow = Object.fromEntries(selectedColumns.map((key) => [exportColumnLabels[key], ''])) as Record<string, unknown>;
    const monetaryKeys = new Set(['quote_amount', 'cost_amount', 'advance_amount', 'profit', 'product_subtotal']);
    const labelKey = selectedColumns.find((key) => !monetaryKeys.has(key));
    if (labelKey) totalRow[exportColumnLabels[labelKey]] = '合计';
    const quoteTotal = orders.reduce((sum, order) => sum + Number(order.quote_amount || 0), 0);
    const costTotal = orders.reduce((sum, order) => sum + Number(order.cost_amount || 0), 0);
    const advanceTotal = orders.reduce((sum, order) => sum + (order.advances || []).reduce((subtotal: number, item: any) => subtotal + Math.round(Number(item.amount || 0) * 100), 0), 0);
    const totals: Record<string, number> = {
      quote_amount: quoteTotal / 100,
      cost_amount: costTotal / 100,
      advance_amount: advanceTotal / 100,
      profit: (quoteTotal - costTotal - advanceTotal) / 100,
      product_subtotal: quoteTotal / 100,
    };
    for (const key of selectedColumns) if (key in totals) totalRow[exportColumnLabels[key]] = totals[key];
    rows.push(totalRow);
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), '订单明细');
  return { data: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), count: dataRowCount };
}

export interface CreateProjectInput {
  customer_id?: string;
  name: string;
  owner?: string;
}

export function createProject(data: CreateProjectInput) {
  const db = getOrderDb();
  return db.transaction(() => {
    const customerId = text(data.customer_id);
    if (!customerId) throw new Error('请从客户管理选择客户');
    if (!db.prepare('SELECT 1 FROM customer_profiles WHERE id=?').get(customerId)) throw new Error('客户不存在，请先在客户管理中创建客户');
    const name = String(data.name || '').trim();
    if (!name) throw new Error('请填写项目名称');
    const projectId = uuid();
    db.prepare('INSERT INTO projects_simple VALUES(?,?,?,?,?,?)').run(projectId, customerId, name, String(data.owner || '').trim(), '进行中', now());
    return db.prepare('SELECT p.*, c.name AS customer_name FROM projects_simple p JOIN customer_profiles c ON c.id=p.customer_id WHERE p.id=?').get(projectId);
  })();
}

// 未填写项目时使用的虚拟项目：按客户分别归档，避免和新订单的客户信息脱节。
const unassignedProjectName = '非分配项目';
function ensureUnassignedProject(db: Database.Database, customerId: string) {
  const existing = db.prepare('SELECT id,customer_id FROM projects_simple WHERE customer_id=? AND name=?').get(customerId, unassignedProjectName) as { id: string; customer_id: string } | undefined;
  if (existing) return existing;
  db.prepare('INSERT OR IGNORE INTO projects_simple(id,customer_id,name,owner,status,created_at) VALUES(?,?,?,?,?,?)').run(uuid(), customerId, unassignedProjectName, '', '进行中', now());
  return db.prepare('SELECT id,customer_id FROM projects_simple WHERE customer_id=? AND name=?').get(customerId, unassignedProjectName) as { id: string; customer_id: string };
}

export function createOrder(data: Record<string, unknown>) {
  const db = getOrderDb();
  const idempotencyKey = text(data.idempotency_key).slice(0, 100);
  if (idempotencyKey) {
    const duplicate = db.prepare('SELECT * FROM orders_simple WHERE idempotency_key=?').get(idempotencyKey) as Record<string, unknown> | undefined;
    if (duplicate) return hydrateOrder(duplicate);
  }
  const requestedProjectId = text(data.project_id);
  const project = requestedProjectId
    ? db.prepare('SELECT * FROM projects_simple WHERE id=?').get(requestedProjectId) as { id: string; customer_id: string } | undefined
    : undefined;
  if (requestedProjectId && !project) throw new Error('项目不存在');
  // 项目选填后客户不能再由项目反查，必须由前端显式提交并校验。
  const customerId = project?.customer_id || text(data.customer_id);
  if (!customerId) throw new Error('请选择客户');
  if (!db.prepare('SELECT 1 FROM customer_profiles WHERE id=?').get(customerId)) throw new Error('客户不存在');
  const projectId = project?.id || ensureUnassignedProject(db, customerId).id;
  const orderSource = text(data.order_source);
  const deliveryDate = text(data.delivery_date);
  const designer = text(data.designer);
  const planner = text(data.planner);
  const executionCompany = text(data.execution_company);
  const products = sanitizeLines(Array.isArray(data.products) ? data.products as Array<Record<string, unknown>> : [], 'name');
  const costs = sanitizeLines(Array.isArray(data.costs) ? data.costs as Array<Record<string, unknown>> : [], 'name');
  if (!products.length) throw new Error('请至少填写一项产品');
  for (const item of [...products, ...costs]) {
    if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) throw new Error('产品和成本数量必须大于 0');
    if (!Number.isFinite(Number(item.unit_price)) || Number(item.unit_price) < 0) throw new Error('产品和成本单价不能为负数');
  }
  for (const [index, item] of products.entries()) {
    if (item.advance && advanceLineAmount(item) <= 0) throw new Error(`第 ${index + 1} 项已开启个人垫付，请填写成本`);
  }
  // 个人垫付报销归属当前录入人；UID 仅接受可信身份传入的值。
  const advanceActor: AdvanceActor = {
    name: text(data.advance_employee) || text(data.created_by) || '填写人',
    uid: Number.isSafeInteger(Number(data.advance_employee_uid)) && Number(data.advance_employee_uid) > 0 ? Number(data.advance_employee_uid) : null
  };
  const primary = products[0] || costs[0];
  const serviceName = String(data.service_name || products.map((item) => text(item.name)).filter(Boolean).join('、') || costs.map((item) => text(item.name)).filter(Boolean).join('、') || primary.name || '订单').trim();
  if (!serviceName) throw new Error('请填写订单内容');
  const quantity = Number(data.quantity || products[0]?.quantity || 1);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('数量必须大于 0');
  const id = uuid();
  const created = now();
  const date = String(data.order_date || todayInBizTZ());
  const code = `ORD-${date.replaceAll('-', '')}-${id.slice(0, 6).toUpperCase()}`;
  const quoteCents = products.length ? products.reduce((sum, item) => sum + moneyToCents(lineTotalYuan(item)), 0) : optionalMoneyToCents(data.quote_amount);
  const costCents = costs.length ? costs.reduce((sum, item) => sum + moneyToCents(lineTotalYuan(item)), 0) : optionalMoneyToCents(data.cost_amount);
  db.transaction(() => {
    db.prepare('INSERT INTO orders_simple(id,code,customer_id,project_id,service_name,quantity,unit,quote_amount,cost_amount,order_date,created_by,status,note,created_at,specification,is_extra,delivery_date,order_source,designer,planner,payment_status,products_json,costs_json,idempotency_key,execution_company) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, code, customerId, projectId, serviceName, quantity, String(data.unit || products[0]?.unit || '项'), quoteCents, costCents, date, String(data.created_by || '填写人'), normalizeOrderStatus(data.status), String(data.note || '').trim(), created, text(data.specification || products[0]?.specification), data.is_extra ? 1 : 0, deliveryDate, orderSource, designer, planner, text(data.payment_status) || '未结款', JSON.stringify(products), JSON.stringify(costs), idempotencyKey, executionCompany);
    const lineIds = syncNormalizedOrderLines(db, id, products, costs);
    syncOrderAdvanceReimbursements(db, { id, code, order_date: date }, products, lineIds, advanceActor);
  })();
  return hydrateOrder(db.prepare('SELECT * FROM orders_simple WHERE id=?').get(id) as Record<string, unknown>);
}

export function updateOrder(id: string, data: Record<string, unknown>) {
  const db = getOrderDb();
  const existing = db.prepare('SELECT * FROM orders_simple WHERE id=?').get(id) as Record<string, unknown> | undefined;
  if (!existing) throw new Error('ORDER_NOT_FOUND');
  const existingProducts = db.prepare('SELECT id AS line_id,catalog_item_id AS catalog_id,name,specification,remark,unit,quantity,unit_price / 100.0 AS unit_price,subtotal / 100.0 AS subtotal FROM order_products WHERE order_id=? ORDER BY position').all(id) as Array<Record<string, unknown>>;
  const existingCosts = db.prepare('SELECT catalog_item_id AS catalog_id,name,vendor,unit,quantity,unit_price / 100.0 AS unit_price,subtotal / 100.0 AS subtotal FROM order_costs WHERE order_id=? ORDER BY position').all(id) as Array<Record<string, unknown>>;
  const products = sanitizeLines(Array.isArray(data.products) ? data.products as Array<Record<string, unknown>> : existingProducts.length ? existingProducts : parseList(existing.products_json), 'name');
  const costs = sanitizeLines(Array.isArray(data.costs) ? data.costs as Array<Record<string, unknown>> : existingCosts.length ? existingCosts : parseList(existing.costs_json), 'name');
  if (!products.length) throw new Error('请至少保留一项产品');
  const deliveryDate = text(data.delivery_date);
  const designer = text(data.designer);
  const planner = text(data.planner);
  const executionCompany = text(data.execution_company);
  for (const item of [...products, ...costs]) {
    if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) throw new Error('产品和成本数量必须大于 0');
    if (!Number.isFinite(Number(item.unit_price)) || Number(item.unit_price) < 0) throw new Error('产品和成本单价不能为负数');
  }
  for (const [index, item] of products.entries()) {
    if (item.advance && advanceLineAmount(item) <= 0) throw new Error(`第 ${index + 1} 项已开启个人垫付，请填写成本`);
  }
  const advanceActor: AdvanceActor = {
    name: text(data.advance_employee) || text(data.created_by) || text(existing.created_by),
    uid: Number.isSafeInteger(Number(data.advance_employee_uid)) && Number(data.advance_employee_uid) > 0 ? Number(data.advance_employee_uid) : null
  };
  const quote = products.reduce((sum, item) => sum + moneyToCents(lineTotalYuan(item)), 0);
  const cost = costs.reduce((sum, item) => sum + moneyToCents(lineTotalYuan(item)), 0);
  const service = products.map((item) => text(item.name)).filter(Boolean).join('、') || text(data.service_name) || String(existing.service_name);
  const requestedProjectId = Object.hasOwn(data, 'project_id') ? text(data.project_id) : text(existing.project_id);
  const targetProject = requestedProjectId
    ? db.prepare('SELECT id,customer_id FROM projects_simple WHERE id=?').get(requestedProjectId) as { id: string; customer_id: string } | undefined
    : undefined;
  if (requestedProjectId && !targetProject) throw new Error('项目不存在');
  const targetCustomerId = targetProject?.customer_id || text(data.customer_id) || text(existing.customer_id);
  if (!targetCustomerId) throw new Error('请选择客户');
  if (!db.prepare('SELECT 1 FROM customer_profiles WHERE id=?').get(targetCustomerId)) throw new Error('客户不存在');
  const targetProjectId = targetProject?.id || ensureUnassignedProject(db, targetCustomerId).id;
  const orderSource = text(data.order_source);
  db.transaction(() => {
    db.prepare(`UPDATE orders_simple SET project_id=?,customer_id=?,service_name=?,quantity=?,unit=?,quote_amount=?,cost_amount=?,order_date=?,delivery_date=?,order_source=?,designer=?,planner=?,execution_company=?,created_by=?,status=?,payment_status=?,note=?,specification=?,products_json=?,costs_json=? WHERE id=?`).run(targetProjectId, targetCustomerId, service, Number(products[0]?.quantity || existing.quantity), text(products[0]?.unit || existing.unit), quote, cost, text(data.order_date || existing.order_date), deliveryDate, orderSource, designer, planner, executionCompany, text(data.created_by || existing.created_by), normalizeOrderStatus(data.status || existing.status), text(data.payment_status || existing.payment_status), text(data.note), text(products[0]?.specification || existing.specification), JSON.stringify(products), JSON.stringify(costs), id);
    const lineIds = syncNormalizedOrderLines(db, id, products, costs);
    syncOrderAdvanceReimbursements(db, { id, code: text(existing.code), order_date: text(data.order_date || existing.order_date) }, products, lineIds, advanceActor);
  })();
  return hydrateOrder(db.prepare(`SELECT o.*,c.name customer_name,p.name project_name,p.owner project_owner FROM orders_simple o JOIN customer_profiles c ON c.id=o.customer_id JOIN projects_simple p ON p.id=o.project_id WHERE o.id=?`).get(id) as Record<string, unknown>);
}

export function deleteOrder(id: string) {
  const db = getOrderDb();
  const files = [
    ...(db.prepare('SELECT storage_path FROM order_attachments WHERE order_id=?').all(id) as Array<{ storage_path: string }>),
    ...(db.prepare('SELECT ra.storage_path FROM reimbursement_attachments ra JOIN reimbursements_simple r ON r.id=ra.reimbursement_id WHERE r.order_id=?').all(id) as Array<{ storage_path: string }>)
  ];
  const result = db.prepare('DELETE FROM orders_simple WHERE id=?').run(id);
  if (!result.changes) throw new Error('ORDER_NOT_FOUND');
  for (const file of files) removeAttachmentFile(file.storage_path);
}

export function listReimbursementOrders(filters: Record<string, string> = {}) {
  const rows = getOrderDb().prepare(`SELECT r.*, o.code, o.project_id, p.name AS project_name, c.name AS customer_name,
    COUNT(ra.id) AS attachment_count
    FROM reimbursements_simple r
    LEFT JOIN orders_simple o ON o.id = r.order_id
    LEFT JOIN projects_simple p ON p.id = o.project_id
    LEFT JOIN customer_profiles c ON c.id = o.customer_id
    LEFT JOIN reimbursement_attachments ra ON ra.reimbursement_id = r.id
    GROUP BY r.id
    ORDER BY r.advance_date DESC, r.created_at DESC`).all() as Array<Record<string, any>>;
  const result = rows.map((item) => ({
    ...item,
    id: item.id,
    order_id: item.order_id || '',
    advance_id: item.id,
    project_id: item.project_id || '',
    project_name: item.project_name || '内务报销',
    customer_name: item.customer_name || '',
    code: item.code || '内务报销',
    advance_item: item.item,
    advance_date: item.advance_date,
    advance_amount: item.amount,
    employee: item.employee,
    employee_uid: item.employee_uid,
    status: item.status,
    invoice: item.invoice,
    note: item.note || '',
    reimbursement_status: reimbursementStatusLabel(item.status),
    voucher_no: item.voucher_no || '',
    voucher_created_at: item.voucher_created_at || '',
    voucher_archived_at: item.voucher_archived_at || '',
    source_type: item.order_id ? '订单报销' : '内务报销'
  })).filter((item) =>
    (!filters.project || item.project_id === filters.project) &&
    (!filters.person || item.employee === filters.person) &&
    (!filters.type || (filters.type === 'order' ? Boolean(item.order_id) : filters.type === 'internal' ? !item.order_id : true)) &&
    (!filters.from || item.advance_date >= filters.from) &&
    (!filters.to || item.advance_date <= filters.to) &&
    (!filters.status || (filters.status === '未报销'
      ? item.reimbursement_status !== '已执行'
      : reimbursementStatusCode(item.reimbursement_status) === reimbursementStatusCode(filters.status)))
  );
  return withApprovalInfo(result);
}

export function exportReimbursements(filters: Record<string, string>) {
  const rows = listReimbursementOrders(filters).filter((row) => !filters.ids || filters.ids.split(',').includes(row.id));
  const mode = filters.mode || 'detail';
  if (mode === 'payment') {
    const groups = new Map<string, Array<Record<string, any>>>();
    for (const row of rows.filter((item) => item.status === 'pending_payment')) groups.set(row.employee, [...(groups.get(row.employee) || []), row]);
    const summary = [...groups.entries()].map(([employee, items]) => ({ 员工: employee, 待付款单数: items.length, 应付金额: items.reduce((sum, item) => sum + Number(item.advance_amount || 0), 0) / 100, 明细: items.map((item) => item.advance_item).join('、'), 最近日期: items.map((item) => item.advance_date).sort().at(-1) || '' }));
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), '待付款汇总');
    return { data: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), count: summary.length, name: '待付款汇总' };
  }
  const output = rows.map((row) => ({ 来源类型: row.source_type, 来源订单: row.code, 客户: row.customer_name, 项目: row.project_name, 报销人: row.employee, 报销物品: row.advance_item, 垫付日期: row.advance_date, 金额: Number(row.advance_amount || 0) / 100, 发票附件: row.invoice || '未上传', 状态: row.reimbursement_status, 单据编号: row.voucher_no || '', 归档时间: row.voucher_archived_at || '', 备注: row.note || '' }));
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(output), mode === 'voucher' ? '报销单据' : '报销明细');
  return { data: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), count: output.length, name: mode === 'voucher' ? '报销单据' : '报销明细' };
}

export function createReimbursement(data: Record<string, unknown>, actorUid: number | null = null) {
  const employee = text(data.employee);
  const item = text(data.item);
  if (!employee || !item) throw new Error('请填写报销人和报销物品');
  const amount = moneyToCents(data.amount);
  if (amount <= 0) throw new Error('报销金额必须大于 0');
  const advanceDate = text(data.advance_date) || todayInBizTZ();
  const orderId = text(data.order_id);
  if (orderId && !getOrderDb().prepare('SELECT id FROM orders_simple WHERE id=?').get(orderId)) throw new Error('关联订单不存在');
  const id = uuid();
  const db = getOrderDb();
  const department = employeeDepartment(db, actorUid);
  db.transaction(() => {
    db.prepare('INSERT INTO reimbursements_simple(id,employee,item,amount,advance_date,order_id,invoice,note,created_at,employee_uid,department) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, employee, item, amount, advanceDate, orderId || null, text(data.invoice), text(data.note), now(), actorUid, department);
    recordAudit(db, { actorName: employee, actorUid, action: 'create', entityType: 'reimbursement', entityId: id, detail: { amount, order_id: orderId, department } });
    recordReimbursementApproval(db, id, 0, 'submitted', employee, actorUid);
  })();
  return { id, employee, employee_uid: actorUid, department, item, amount, advance_date: advanceDate, order_id: orderId, reimbursement_status: reimbursementStatusLabel('pending_review') };
}

const reimbursementTransitions: Record<ReimbursementStatusCode, ReimbursementStatusCode[]> = {
  pending_proof: ['pending_review'],
  pending_review: ['pending_recheck', 'rejected'], pending_recheck: ['pending_confirmation', 'rejected'],
  pending_confirmation: ['pending_payment', 'rejected'], pending_payment: ['paid'], rejected: [], paid: []
};
export function canAdvanceReimbursement(
  row: { status: string; department?: string; employee_uid?: number | null },
  target: string,
  identity: { uid: number; role: string }
): boolean {
  const from = reimbursementStatusCode(row.status);
  const to = reimbursementStatusCode(target);
  if (!reimbursementTransitions[from]?.includes(to)) return false;
  if (!canActOnReimbursement(row, identity)) return false;
  const step = reimbursementStepForStatus(from);
  if (!step) return false;
  if (to === 'rejected') return step.layer < 4;
  return reimbursementNextCodeForLayer(step.layer) === to;
}

export function updateReimbursement(id: string, status: string, actor: string, rejectReason = '', actorUid: number | null = null) {
  const target = reimbursementStatusCode(status);
  const db = getOrderDb();
  const reimbursement = db.prepare('SELECT * FROM reimbursements_simple WHERE id=?').get(id) as Record<string, any> | undefined;
  if (!reimbursement) throw new Error('REIMBURSEMENT_NOT_FOUND');
  if (!reimbursementTransitions[reimbursement.status as ReimbursementStatusCode]?.includes(target)) throw new Error('INVALID_REIMBURSEMENT_TRANSITION');
  if (target === 'rejected' && !text(rejectReason)) throw new Error('请填写打回原因');
  const changedAt = now();
  db.transaction(() => {
    db.prepare(`UPDATE reimbursements_simple SET status=?, reject_reason=CASE WHEN ?='rejected' THEN ? WHEN ?='pending_review' THEN '' ELSE reject_reason END, reviewed_by=CASE WHEN ? IN ('pending_payment','rejected') THEN ? ELSE reviewed_by END, reviewed_at=CASE WHEN ? IN ('pending_payment','rejected') THEN ? ELSE reviewed_at END, reimbursed_by=CASE WHEN ?='paid' THEN ? ELSE reimbursed_by END, reimbursed_at=CASE WHEN ?='paid' THEN ? ELSE reimbursed_at END WHERE id=?`).run(target, target, rejectReason, target, target, actor, target, changedAt, target, actor, target, changedAt, id);
    const step = reimbursementStepForStatus(reimbursement.status);
    const action = target === 'rejected' ? 'rejected' : target === 'paid' ? 'executed' : 'approved';
    recordReimbursementApproval(db, id, step?.layer ?? 0, action, actor, actorUid, target === 'rejected' ? rejectReason : '');
    recordAudit(db, { actorName: actor, actorUid, action: 'status_change', entityType: 'reimbursement', entityId: id, fromValue: reimbursement.status, toValue: target, detail: { reject_reason: target === 'rejected' ? rejectReason : '', layer: step?.layer ?? null } });
    if (target === 'pending_payment') ensureReimbursementVoucher(db, reimbursement, actor, actorUid, true);
  })();
  const updated = db.prepare('SELECT * FROM reimbursements_simple WHERE id=?').get(id) as Record<string, any>;
  return { ...updated, order_id: updated.order_id || '', reimbursement_status: reimbursementStatusLabel(updated.status) };
}

export function updateReimbursementsBatch(ids: string[], status: string, actor: string, rejectReason = '', actorUid: number | null = null) {
  const target = reimbursementStatusCode(status);
  const uniqueIds = [...new Set(ids.map((id) => text(id)).filter(Boolean))];
  if (!uniqueIds.length) throw new Error('请选择报销记录');
  if (target === 'rejected' && !text(rejectReason)) throw new Error('请填写打回原因');
  const db = getOrderDb();
  const rows = uniqueIds.map((id) => db.prepare('SELECT * FROM reimbursements_simple WHERE id=?').get(id) as Record<string, any> | undefined);
  if (rows.some((row) => !row)) throw new Error('REIMBURSEMENT_NOT_FOUND');
  for (const row of rows as Array<Record<string, any>>) if (!reimbursementTransitions[row.status as ReimbursementStatusCode]?.includes(target)) throw new Error('INVALID_REIMBURSEMENT_TRANSITION');
  const changedAt = now();
  db.transaction(() => {
    const update = db.prepare(`UPDATE reimbursements_simple SET status=?, reject_reason=CASE WHEN ?='rejected' THEN ? WHEN ?='pending_review' THEN '' ELSE reject_reason END, reviewed_by=CASE WHEN ? IN ('pending_payment','rejected') THEN ? ELSE reviewed_by END, reviewed_at=CASE WHEN ? IN ('pending_payment','rejected') THEN ? ELSE reviewed_at END, reimbursed_by=CASE WHEN ?='paid' THEN ? ELSE reimbursed_by END, reimbursed_at=CASE WHEN ?='paid' THEN ? ELSE reimbursed_at END WHERE id=?`);
    for (const row of rows as Array<Record<string, any>>) {
      update.run(target, target, rejectReason, target, target, actor, target, changedAt, target, actor, target, changedAt, row.id);
      const step = reimbursementStepForStatus(row.status);
      const action = target === 'rejected' ? 'rejected' : target === 'paid' ? 'executed' : 'approved';
      recordReimbursementApproval(db, row.id, step?.layer ?? 0, action, actor, actorUid, target === 'rejected' ? rejectReason : '');
      recordAudit(db, { actorName: actor, actorUid, action: 'status_change', entityType: 'reimbursement', entityId: row.id, fromValue: row.status, toValue: target, detail: { batch: true, reject_reason: target === 'rejected' ? rejectReason : '', layer: step?.layer ?? null } });
      if (target === 'pending_payment') ensureReimbursementVoucher(db, row, actor, actorUid, true);
    }
  })();
  return uniqueIds.map((id) => {
    const row = db.prepare('SELECT * FROM reimbursements_simple WHERE id=?').get(id) as Record<string, any>;
    return { ...row, order_id: row.order_id || '', reimbursement_status: reimbursementStatusLabel(row.status) };
  });
}

export function generateReimbursementVoucher(id: string, actor = '财务人员', actorUid: number | null = null) {
  const db = getOrderDb();
  const row = db.prepare('SELECT * FROM reimbursements_simple WHERE id=?').get(id) as Record<string, any> | undefined;
  if (!row) throw new Error('REIMBURSEMENT_NOT_FOUND');
  if (!['pending_payment', 'paid'].includes(row.status)) throw new Error('报销确认后才能生成单据');
  const voucher = ensureReimbursementVoucher(db, row, actor, actorUid);
  return { ...row, voucher_no: voucher.voucherNo, voucher_created_at: voucher.createdAt, order_id: row.order_id || '', reimbursement_status: reimbursementStatusLabel(row.status) };
}

export function archiveReimbursementVoucher(id: string, actor = '财务人员', actorUid: number | null = null) {
  const db = getOrderDb();
  const row = db.prepare("SELECT status,voucher_no FROM reimbursements_simple WHERE id=?").get(id) as { status: string; voucher_no: string } | undefined;
  if (!row) throw new Error('REIMBURSEMENT_NOT_FOUND');
  if (!row.voucher_no) throw new Error('请先生成报销单据');
  if (!['pending_payment', 'paid'].includes(row.status)) throw new Error('当前状态不能归档单据');
  const archivedAt = now();
  db.prepare('UPDATE reimbursements_simple SET voucher_archived_at=? WHERE id=?').run(archivedAt, id);
  recordAudit(db, { actorName: actor, actorUid, action: 'archive_voucher', entityType: 'reimbursement', entityId: id, detail: { voucher_no: row.voucher_no } });
  return { id, voucher_no: row.voucher_no, voucher_archived_at: archivedAt };
}

export function deleteReimbursement(id: string) {
  const db = getOrderDb();
  const files = db.prepare('SELECT storage_path FROM reimbursement_attachments WHERE reimbursement_id=?').all(id) as Array<{ storage_path: string }>;
  const result = db.prepare("DELETE FROM reimbursements_simple WHERE id=? AND status IN ('pending_proof','pending_review')").run(id);
  if (!result.changes) throw new Error('REIMBURSEMENT_NOT_FOUND');
  for (const file of files) removeAttachmentFile(file.storage_path);
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
  return getOrderDb().prepare('SELECT id,order_id,file_name,mime_type,file_size,attachment_kind,created_at FROM order_attachments WHERE order_id=? ORDER BY created_at DESC').all(orderId);
}

export function addStandaloneReimbursementAttachment(reimbursementId: string, file: { name: string; data: Buffer; kind?: string }, actor: { name?: string; uid?: number | null } = {}) {
  const db = getOrderDb();
  const reimbursement = db.prepare('SELECT id,employee,status FROM reimbursements_simple WHERE id=?').get(reimbursementId) as { id: string; employee: string; status: string } | undefined;
  if (!reimbursement) throw new Error('REIMBURSEMENT_NOT_FOUND');
  if (!['pending_proof', 'pending_review', 'rejected'].includes(reimbursement.status)) throw new Error('当前状态不允许上传附件');
  const attachmentKind = file.kind === 'proof' ? 'proof' : 'invoice';
  if (!file.data?.length) throw new Error('附件内容为空');
  if (file.data.length > maxAttachmentSize) throw new Error('单个附件不能超过 10MB');
  const mime = detectAttachmentMime(file.data);
  if (!mime) throw new Error('仅支持上传图片（PNG/JPG/GIF/WebP）或 PDF 文件');
  const id = uuid();
  const safeName = (file.name || '发票附件').replace(/[\\/:*?"<>|\r\n\t]+/g, '_').trim().slice(-120) || '发票附件';
  const extension = mime === 'application/pdf' ? '.pdf' : `.${mime.split('/')[1].replace('jpeg', 'jpg')}`;
  const storagePath = join(`reimbursements/${reimbursementId}`, `${id}${extension}`);
  mkdirSync(join(attachmentDir, `reimbursements/${reimbursementId}`), { recursive: true });
  writeFileSync(join(attachmentDir, storagePath), file.data);
  db.prepare('INSERT INTO reimbursement_attachments(id,reimbursement_id,file_name,mime_type,file_size,storage_path,attachment_kind,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, reimbursementId, safeName, mime, file.data.length, storagePath, attachmentKind, now());
  const status = (reimbursement.status === 'rejected' ? 'pending_review' : reimbursement.status);
  db.transaction(() => {
    if (attachmentKind === 'invoice') {
      db.prepare("UPDATE reimbursements_simple SET invoice=?, status=?, reject_reason=CASE WHEN ?='pending_review' THEN '' ELSE reject_reason END WHERE id=?").run(safeName, status, status, reimbursementId);
    }
    if (reimbursement.status === 'rejected') {
      recordReimbursementApproval(db, reimbursementId, 0, 'resubmitted', actor.name || reimbursement.employee, actor.uid ?? null, safeName);
    }
    recordAudit(db, { actorName: actor.name || reimbursement.employee, actorUid: actor.uid ?? null, action: reimbursement.status === 'rejected' ? 'reupload_attachment' : 'upload_attachment', entityType: 'reimbursement', entityId: reimbursementId, detail: { file_name: safeName, file_size: file.data.length, attachment_kind: attachmentKind } });
  })();
  return { id, reimbursement_id: reimbursementId, file_name: safeName, mime_type: mime, file_size: file.data.length, attachment_kind: attachmentKind, created_at: now() };
}

/**
 * 申请修改报销金额：只改报销金额，不改订单成本。
 * 待上传证明/已打回/待一级审核（尚未有人审核）可由报销人发起；
 * 修改原因和前后金额写入审批记录，后续审核人据此确认。
 */
export function requestReimbursementAmountChange(
  id: string,
  amountValue: unknown,
  changeReason: unknown,
  actor: { name?: string; uid?: number | null } = {}
) {
  const db = getOrderDb();
  const reimbursement = db.prepare('SELECT * FROM reimbursements_simple WHERE id=?').get(id) as Record<string, any> | undefined;
  if (!reimbursement) throw new Error('REIMBURSEMENT_NOT_FOUND');
  if (reimbursement.status === 'paid') throw new Error('已执行的报销不能修改金额');
  if (reimbursement.voucher_archived_at) throw new Error('报销单据已归档，不能修改金额');
  if (!['pending_proof', 'pending_review', 'pending_recheck', 'pending_confirmation', 'pending_payment', 'rejected'].includes(reimbursement.status)) {
    throw new Error('当前状态不能申请修改金额');
  }
  const reason = text(changeReason);
  if (!reason) throw new Error('请填写修改金额的原因');
  const amount = moneyToCents(amountValue);
  if (amount <= 0) throw new Error('报销金额必须大于 0');
  if (amount === reimbursement.amount) throw new Error('新金额与当前金额相同');
  // 已进入审核的报销修改后必须退回到上一个审核节点重新审核。
  const rollbackStatus: Record<string, ReimbursementStatusCode> = {
    pending_recheck: 'pending_review',
    pending_confirmation: 'pending_recheck',
    pending_payment: 'pending_confirmation'
  };
  const targetStatus = rollbackStatus[reimbursement.status] || reimbursementStatusCode(reimbursement.status);
  const targetStep = reimbursementStepForStatus(targetStatus);
  const rolledBack = targetStatus !== reimbursementStatusCode(reimbursement.status);
  const changedAt = now();
  const oldAmount = (Number(reimbursement.amount || 0) / 100).toFixed(2);
  const newAmount = (amount / 100).toFixed(2);
  const revisionNote = rolledBack
    ? `金额由 ${oldAmount} 元调整为 ${newAmount} 元，报销已退回${reimbursementStatusLabel(targetStatus)}重新审核；原因：${reason}`
    : `金额由 ${oldAmount} 元调整为 ${newAmount} 元；原因：${reason}`;
  db.transaction(() => {
    // 待执行阶段若已自动生成单据，修改后退回审核时清空未归档单号，重新通过后按新金额生成。
    const clearVoucher = reimbursement.status === 'pending_payment' && !reimbursement.voucher_archived_at;
    db.prepare(`UPDATE reimbursements_simple SET amount=?, amount_adjusted=1, amount_change_note=?,
      content_modified=1, content_modified_at=?, status=?,
      voucher_no=CASE WHEN ? THEN '' ELSE voucher_no END,
      voucher_created_at=CASE WHEN ? THEN NULL ELSE voucher_created_at END WHERE id=?`)
      .run(amount, reason, changedAt, targetStatus, clearVoucher ? 1 : 0, clearVoucher ? 1 : 0, id);
    recordReimbursementApproval(
      db,
      id,
      targetStep?.layer ?? 0,
      'content_modified',
      actor.name || reimbursement.employee,
      actor.uid ?? null,
      revisionNote
    );
    recordAudit(db, {
      actorName: actor.name || reimbursement.employee,
      actorUid: actor.uid ?? null,
      action: 'request_amount_change',
      entityType: 'reimbursement',
      entityId: id,
      fromValue: String(reimbursement.status),
      toValue: targetStatus,
      detail: { reason, old_amount: reimbursement.amount, new_amount: amount, rolled_back: rolledBack, changed_at: changedAt }
    });
  })();
  const updated = db.prepare('SELECT * FROM reimbursements_simple WHERE id=?').get(id) as Record<string, any>;
  return { ...updated, order_id: updated.order_id || '', reimbursement_status: reimbursementStatusLabel(updated.status) };
}

/** 员工上传付款截图与发票后提交，报销从“待上传证明”进入一级审核。 */
export function submitReimbursementProof(id: string, actor: { name?: string; uid?: number | null } = {}) {
  const db = getOrderDb();
  const reimbursement = db.prepare('SELECT * FROM reimbursements_simple WHERE id=?').get(id) as Record<string, any> | undefined;
  if (!reimbursement) throw new Error('REIMBURSEMENT_NOT_FOUND');
  if (reimbursement.status !== 'pending_proof') throw new Error('当前报销无需上传证明');
  const attachments = db.prepare('SELECT attachment_kind FROM reimbursement_attachments WHERE reimbursement_id=?').all(id) as Array<{ attachment_kind: string }>;
  const hasProof = attachments.some((file) => file.attachment_kind === 'proof');
  const hasInvoice = attachments.some((file) => file.attachment_kind === 'invoice');
  if (!hasProof || !hasInvoice) throw new Error('请先上传付款截图和发票');
  const changedAt = now();
  db.transaction(() => {
    db.prepare("UPDATE reimbursements_simple SET status='pending_review', reject_reason='' WHERE id=?").run(id);
    recordReimbursementApproval(db, id, 0, 'submitted', actor.name || reimbursement.employee, actor.uid ?? null, '付款截图与发票已上传');
    recordAudit(db, { actorName: actor.name || reimbursement.employee, actorUid: actor.uid ?? null, action: 'status_change', entityType: 'reimbursement', entityId: id, fromValue: reimbursement.status, toValue: 'pending_review', detail: { proof_submitted_at: changedAt } });
  })();
  const updated = db.prepare('SELECT * FROM reimbursements_simple WHERE id=?').get(id) as Record<string, any>;
  return { ...updated, order_id: updated.order_id || '', reimbursement_status: reimbursementStatusLabel(updated.status) };
}

export function getReimbursementAccessInfo(reimbursementId: string) {
  return getOrderDb().prepare('SELECT id,employee,employee_uid,status,department FROM reimbursements_simple WHERE id=?').get(reimbursementId) as { id: string; employee: string; employee_uid: number | null; status: string; department: string } | undefined;
}

export function setReimbursementEmployee(id: string, uid: number) {
  const db = getOrderDb();
  db.prepare("UPDATE reimbursements_simple SET employee_uid=?,department=CASE WHEN department='' THEN ? ELSE department END WHERE id=?")
    .run(uid, employeeDepartment(db, uid), id);
}

export function listReimbursementAttachments(reimbursementId: string) {
  return getOrderDb().prepare('SELECT id,reimbursement_id,file_name,mime_type,file_size,attachment_kind,created_at FROM reimbursement_attachments WHERE reimbursement_id=? ORDER BY created_at DESC').all(reimbursementId);
}

export function getReimbursementAttachment(attachmentId: string) {
  return getOrderDb().prepare('SELECT id,reimbursement_id,file_name,mime_type,file_size,storage_path,created_at FROM reimbursement_attachments WHERE id=?').get(attachmentId);
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
  try { unlinkSync(path); } catch (reason) { console.warn(`附件清理失败: ${path}`, reason); }
}

export function addOrderAttachment(orderId: string, file: { name: string; data: Buffer; kind?: string; advanceId?: string }, actor: { name?: string; uid?: number | null } = {}) {
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
  const attachmentKind = file.kind === 'design' ? 'design' : 'note';
  db.prepare('INSERT INTO order_attachments(id,order_id,file_name,mime_type,file_size,created_at,storage_path,attachment_kind) VALUES(?,?,?,?,?,?,?,?)').run(id, order.id, safeName, mime, file.data.length, now(), storagePath, attachmentKind);
  recordAudit(db, { actorName: actor.name || '填写人', actorUid: actor.uid ?? null, action: 'upload_attachment', entityType: 'order', entityId: order.id, detail: { file_name: safeName, file_size: file.data.length } });
  return db.prepare('SELECT id,order_id,file_name,mime_type,file_size,attachment_kind,created_at FROM order_attachments WHERE id=?').get(id);
}

export function importCatalog(rows: Array<Record<string, unknown>>, sourceId = '', options: { replace?: boolean; actorName?: string; actorUid?: number | null } = {}) {
  const db = getOrderDb();
  const source = sourceId ? db.prepare('SELECT * FROM catalog_sources WHERE id=?').get(sourceId) as Record<string, unknown> | undefined : undefined;
  if (sourceId && !source) throw new Error('资料库来源不存在');
  const kind = text(source?.kind) === 'cost' ? 'cost' : 'quote';
  const insertQuote = db.prepare(`INSERT INTO catalog_quote_items(id,source_id,active,item_no,category,name,specification,unit,estimated_quantity,price_incl_tax,max_price,customer_name,project_name,remark,source_file,source_sheet,source_type,raw_data,created_at)
    VALUES(@id,@sourceId,1,@itemNo,@category,@name,@specification,@unit,@estimatedQuantity,@price,@maxPrice,@customerName,@projectName,@remark,@sourceFile,@sourceSheet,@sourceType,@raw,@createdAt) ON CONFLICT(category,name,customer_name,project_name,specification,estimated_quantity) DO UPDATE SET source_id=excluded.source_id,active=1,item_no=excluded.item_no,unit=excluded.unit,price_incl_tax=excluded.price_incl_tax,max_price=excluded.max_price,remark=excluded.remark,source_file=excluded.source_file,source_sheet=excluded.source_sheet,source_type=excluded.source_type,raw_data=excluded.raw_data`);
  const insertCost = db.prepare(`INSERT INTO catalog_cost_items(id,source_id,active,item_no,category,name,specification,unit,supplier_name,cost_unit,min_quantity,remark,source_file,source_sheet,source_type,raw_data,created_at)
    VALUES(@id,@sourceId,1,@itemNo,@category,@name,@specification,@unit,@supplierName,@cost,@minQuantity,@remark,@sourceFile,@sourceSheet,@sourceType,@raw,@createdAt) ON CONFLICT(category,name,supplier_name,specification) DO UPDATE SET source_id=excluded.source_id,active=1,item_no=excluded.item_no,unit=excluded.unit,cost_unit=excluded.cost_unit,min_quantity=excluded.min_quantity,remark=excluded.remark,source_file=excluded.source_file,source_sheet=excluded.source_sheet,source_type=excluded.source_type,raw_data=excluded.raw_data`);
  return db.transaction(() => {
    let count = 0;
    if (source && options.replace) {
      db.prepare('UPDATE catalog_quote_items SET active=0 WHERE source_id=?').run(sourceId);
      db.prepare('UPDATE catalog_cost_items SET active=0 WHERE source_id=?').run(sourceId);
    }
    for (const row of rows) {
      const name = text(row.name || row['名称'] || row['服务名称'] || row['产品名称'] || row['材料名称'] || row['服务项目']);
      if (!name) continue;
      const owner = text(source?.owner_name);
      const category = text(row.category || row['分类'] || row['类别'] || '');
      const specification = text(row.specification || row['规格和技术要求'] || row['规格/尺寸'] || row['备注'] || '');
      const unit = text(row.unit || row['单位'] || '项');
      const itemNo = text(row.item_no || row['序号'] || count + 1);
      const sourceFile = text(source?.source_file || row.source_file);
      const sourceSheet = text(row.source_sheet);
      const sourceType = source ? String(source.kind === 'cost' ? 'supplier_cost' : 'customer_quote') : 'upload';
      const raw = JSON.stringify(row);
      const remark = text(row.remark || row.supplier_remark || row['备注'] || '');
      if (kind === 'cost') {
        const cost = row.cost_unit ?? row['成本'] ?? row['成本单价'] ?? row['含13%税单价(元）'] ?? 0;
        const supplierName = text(row.supplier_name || row['供应商'] || row['厂商'] || (source ? owner : ''));
        insertCost.run({ id: uuid(), sourceId: sourceId || null, itemNo, category, name, specification, unit, supplierName, cost: excelMoney(cost), minQuantity: text(row.min_quantity || row['起订量'] || ''), remark, sourceFile, sourceSheet, sourceType, raw, createdAt: now() });
      } else {
        const quote = row.unit_price ?? row.quote_unit ?? row.price_incl_tax ?? row['单价'] ?? row['报价'] ?? row['报价单价'] ?? row['含税投标单价报价'] ?? row['含税单价（元）'] ?? row['含税单价'] ?? 0;
        // 一个报价库对应一个客户：客户名统一取资料库来源名称，保证与订单客户列表、报价匹配口径一致。
        const customerName = text(source ? owner : (row.customer_name || row['客户'] || row['公司'] || row['企业']));
        const projectName = text(row.project_name || row['项目'] || row['项目名称'] || '');
        const estimatedQuantity = text(row.estimated_quantity || row['预估数量'] || '');
        insertQuote.run({ id: uuid(), sourceId: sourceId || null, itemNo, category, name, specification, unit, estimatedQuantity, price: excelMoney(quote), maxPrice: excelMoney(row.max_quote_unit || row['最高单价限价'] || row['含税最高单价限价'] || 0), customerName, projectName, remark, sourceFile, sourceSheet, sourceType, raw, createdAt: now() });
      }
      count++;
    }
    if (source) {
      const summary = JSON.stringify({ rows: rows.length, imported: count, replaced: Boolean(options.replace), imported_at: now() });
      db.prepare("UPDATE catalog_sources SET source_file=COALESCE(NULLIF(?,''),source_file),source_method='upload',import_summary_json=?,updated_at=? WHERE id=?").run(text(rows[0]?.source_file), summary, now(), sourceId);
      if (kind === 'quote') ensureCustomerProfile(db, text(source.owner_name));
      recordAudit(db, { actorName: options.actorName, actorUid: options.actorUid ?? null, action: options.replace ? 'replace_catalog' : 'import_catalog', entityType: 'catalog_source', entityId: sourceId, detail: { rows: rows.length, imported: count } });
    }
    return count;
  })();
}

export type AdminDemoStats = {
  catalogSources: number;
  costCatalogSources: number;
  catalogItems: number;
  orders: number;
  reimbursements: number;
};

export function getAdminDemoStats(): AdminDemoStats {
  const db = getOrderDb();
  return {
    catalogSources: Number((db.prepare('SELECT COUNT(*) AS count FROM catalog_sources WHERE active=1').get() as { count: number }).count),
    costCatalogSources: Number((db.prepare("SELECT COUNT(*) AS count FROM catalog_sources WHERE active=1 AND kind='cost'").get() as { count: number }).count),
    catalogItems: Number((db.prepare('SELECT (SELECT COUNT(*) FROM catalog_quote_items WHERE active=1)+(SELECT COUNT(*) FROM catalog_cost_items WHERE active=1) AS count').get() as { count: number }).count),
    orders: Number((db.prepare('SELECT COUNT(*) AS count FROM orders_simple').get() as { count: number }).count),
    reimbursements: Number((db.prepare('SELECT COUNT(*) AS count FROM reimbursements_simple').get() as { count: number }).count),
  };
}

function demoBatchId() {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `${stamp}-${uuid().slice(0, 4).toUpperCase()}`;
}

function dateOffset(base: Date | string, days: number) {
  return addDaysInBizTZ(typeof base === 'string' ? base : todayInBizTZ(base), days);
}

export function seedDemoCostCatalogs(requestedCount = 2, actorUid: number | null = null) {
  const count = Math.max(1, Math.min(2, Math.round(Number(requestedCount) || 2)));
  const batch = demoBatchId();
  const vendors = [
    {
      name: '华彩喷印',
      rows: [
        ['喷绘制作', '户外高清喷绘布，含基础制作', '平方米', 18],
        ['车贴裱板', '黑胶车贴裱 5mm PVC 板', '平方米', 42],
        ['KT板写真', '室内写真裱 KT 板', '平方米', 36],
        ['门型展架画面', '80×180cm PP 合成纸画面', '套', 48],
        ['易拉宝', '铝合金易拉宝含画面', '套', 88],
        ['UV软膜', 'UV 软膜灯箱画面', '平方米', 58],
        ['横幅', '70cm 宽牛津布热转印', '米', 12],
        ['安装人工', '市区普通墙面安装', '人次', 280],
      ],
    },
    {
      name: '嘉印物料',
      rows: [
        ['宣传单', '157g 铜版纸双面彩印，1000 张起', '张', 0.18],
        ['折页', '200g 铜版纸三折页，压痕折叠', '张', 0.42],
        ['画册', 'A4 骑马钉 20P，封面 250g', '本', 6.8],
        ['名片', '300g 铜版纸双面覆膜', '盒', 22],
        ['手提袋', '250g 白卡纸四色印刷', '个', 3.6],
        ['台卡', 'A5 亚克力台卡含画面', '个', 28],
        ['不干胶标签', '覆膜模切，按常规尺寸', '张', 0.35],
        ['加急制作', '24 小时内交付加急费', '项', 180],
      ],
    },
  ];
  const created: Array<{ id: string; owner: string; items: number }> = [];
  for (const vendor of vendors.slice(0, count)) {
    const owner = `${vendor.name}·模拟${batch}`;
    const source = createCatalogSource({ kind: 'cost', owner_name: owner, source_method: 'admin_demo', source_file: `后台模拟成本库-${batch}.xlsx` }) as { id: string };
    const rows = vendor.rows.map(([name, specification, unit, cost], index) => ({
      category: index < 4 ? '广告制作' : '综合物料',
      name,
      specification,
      unit,
      cost_unit: cost,
      supplier_remark: `${owner}模拟报价`,
      source_file: `后台模拟成本库-${batch}.xlsx`,
      source_sheet: vendor.name,
      item_no: index + 1,
    }));
    const items = importCatalog(rows, source.id, { actorName: '后台模拟数据工具', actorUid });
    created.push({ id: source.id, owner, items });
  }
  addAuditLog({ actorName: '后台模拟数据工具', actorUid, action: 'seed_demo_catalogs', entityType: 'admin_demo', entityId: batch, detail: { count: created.length, items: created.reduce((sum, item) => sum + item.items, 0) } });
  return { batch, catalogs: created.length, items: created.reduce((sum, item) => sum + item.items, 0), created };
}

function ensureDemoProjects() {
  const db = getOrderDb();
  const definitions = [
    ['星河科技（模拟）', '年度品牌物料（模拟）', '陈晨'],
    ['星河科技（模拟）', '春季招商活动（模拟）', '陈晨'],
    ['海岸商业（模拟）', '商场导视更新（模拟）', '林晓'],
    ['青禾教育（模拟）', '招生季宣传（模拟）', '周敏'],
  ];
  const result: Array<{ id: string; customer_id: string; customer_name: string; name: string; owner: string }> = [];
  db.transaction(() => {
    for (const [customerName, projectName, owner] of definitions) {
      let customer = db.prepare('SELECT id FROM customer_profiles WHERE name=?').get(customerName) as { id: string } | undefined;
      if (!customer) {
        customer = { id: uuid() };
        const timestamp = now();
        db.prepare(`INSERT INTO customer_profiles(id,name,tax_no,contact,phone,address,bank_name,bank_account,note,created_at,updated_at) VALUES(?,?,'',?,'','','','','',?,?)`)
          .run(customer.id, customerName, '模拟联系人', timestamp, timestamp);
      }
      let project = db.prepare('SELECT id FROM projects_simple WHERE customer_id=? AND name=?').get(customer.id, projectName) as { id: string } | undefined;
      if (!project) {
        project = { id: uuid() };
        db.prepare('INSERT INTO projects_simple(id,customer_id,name,owner,status,created_at) VALUES(?,?,?,?,?,?)').run(project.id, customer.id, projectName, owner, '进行中', now());
      }
      result.push({ id: project.id, customer_id: customer.id, customer_name: customerName, name: projectName, owner });
    }
  })();
  return result;
}

export function seedDemoOrdersAndReimbursements(requestedCount = 36, actorUid: number | null = null) {
  const orderCount = Math.max(20, Math.min(80, Math.round(Number(requestedCount) || 36)));
  const batch = demoBatchId();
  const projects = ensureDemoProjects();
  const db = getOrderDb();
  const costItems = db.prepare(`SELECT ki.id,ki.name,ki.unit,ki.cost_unit,ki.supplier_name AS owner_name
    FROM catalog_cost_items ki JOIN catalog_sources cs ON cs.id=ki.source_id
    WHERE ki.active=1 AND cs.active=1 AND cs.kind='cost' ORDER BY cs.updated_at DESC,ki.name LIMIT 30`).all() as Array<Record<string, any>>;
  const productTemplates = [
    ['活动主视觉喷绘', '平方米', 68, '户外高清喷绘，含画面排版'],
    ['商场导视画面', '块', 185, 'PVC 板裱写真并覆膜'],
    ['招商宣传折页', '张', 1.25, '200g 铜版纸三折页'],
    ['品牌宣传画册', '本', 18.8, 'A4 骑马钉 20P'],
    ['门型展架', '套', 168, '80×180cm 展架含画面'],
    ['活动签到背景板', '平方米', 138, '桁架背景搭建及画面'],
    ['桌面亚克力台卡', '个', 58, 'A5 亚克力双面台卡'],
    ['宣传手提袋', '个', 8.6, '250g 白卡纸覆膜穿绳'],
  ];
  const activeEmployees = db.prepare('SELECT catsco_uid,display_name FROM employees WHERE active=1 ORDER BY catsco_uid').all() as Array<{ catsco_uid: number; display_name: string }>;
  const employees = activeEmployees.length ? activeEmployees.map((row) => row.display_name) : ['张琳', '王杰', '李倩', '陈晨', '林晓', '周敏'];
  const designers = ['刘设计', '赵设计', '何设计', '孙设计'];
  const advanceItems = ['现场打车费', '临时材料采购', '加急快递费', '活动停车费', '安装辅料费', '客户现场餐费'];
  const today = new Date();
  let reimbursementCount = 0;
  const statusCounts: Record<string, number> = { pending_review: 0, pending_recheck: 0, pending_confirmation: 0, pending_payment: 0, paid: 0, rejected: 0 };
  const stages = ['pending_review', 'pending_recheck', 'pending_confirmation', 'pending_payment', 'paid', 'rejected'] as const;
  function advanceDemoReimbursement(id: string, index: number) {
    const stage = stages[index % stages.length];
    if (stage === 'rejected') {
      updateReimbursement(id, '已打回', '模拟管理人', '模拟数据：请补充清晰发票');
    } else {
      if (stage !== 'pending_review') updateReimbursement(id, '待二级审核', '模拟管理人');
      if (['pending_confirmation', 'pending_payment', 'paid'].includes(stage)) updateReimbursement(id, '待三级审核', '模拟财务');
      if (['pending_payment', 'paid'].includes(stage)) updateReimbursement(id, '待执行', '模拟老板');
      if (stage === 'paid') updateReimbursement(id, '已执行', '模拟财务');
    }
    statusCounts[stage]++;
    return stage;
  }

  for (let index = 0; index < orderCount; index++) {
    const project = projects[index % projects.length];
    const orderDate = dateOffset(today, -(index * 3 % 120));
    const deliveryDate = dateOffset(orderDate, 4 + index % 12);
    const primary = productTemplates[index % productTemplates.length];
    const secondary = productTemplates[(index + 3) % productTemplates.length];
    const quantity = 2 + index % 9;
    const products = [
      { name: primary[0], unit: primary[1], quantity, unit_price: Number(primary[2]), specification: primary[3] },
      ...(index % 3 === 0 ? [{ name: secondary[0], unit: secondary[1], quantity: 1 + index % 4, unit_price: Number(secondary[2]), specification: secondary[3] }] : []),
    ];
    const matchedCost = costItems[index % Math.max(costItems.length, 1)];
    const fallbackCost = { id: '', name: `${primary[0]}制作成本`, unit: primary[1], cost_unit: Math.round(Number(primary[2]) * 62), owner_name: '模拟供应商' };
    const cost = matchedCost || fallbackCost;
    const hasAdvance = index % 3 !== 0;
    const employee = employees[index % employees.length];
    const order = createOrder({
      project_id: project.id,
      order_date: orderDate,
      delivery_date: deliveryDate,
      order_source: `${['市场部', '品牌部', '综合事务部'][index % 3]}-${['黄经理', '吴老师', '梁主管'][index % 3]}`,
      designer: designers[index % designers.length],
      created_by: employee,
      status: ['已提交', '已完成'][index % 2],
      payment_status: index % 4 === 0 ? '已结款' : '未结款',
      note: `后台模拟订单 · 批次 ${batch}`,
      products,
      costs: [{
        catalog_id: cost.id || '',
        name: cost.name,
        vendor: cost.owner_name || '模拟供应商',
        unit: cost.unit || '项',
        quantity,
        unit_price: Math.max(0, Number(cost.cost_unit || 0) / 100),
      }],
      idempotency_key: `admin-demo-${batch}-${index}`,
    });
    if (hasAdvance) {
      const reimbursement = createReimbursement({
        employee,
        item: advanceItems[index % advanceItems.length],
        amount: 35 + index % 8 * 18.5,
        advance_date: orderDate,
        order_id: order.id,
        invoice: index % 4 === 0 ? '模拟电子发票.pdf' : '',
        note: `后台模拟报销 · 批次 ${batch}`,
      });
      if (activeEmployees.length) {
        const uid = resolveEmployeeUidByName(db, employee);
        db.prepare("UPDATE reimbursements_simple SET employee_uid=?,department=COALESCE((SELECT department FROM employees WHERE catsco_uid=?),department) WHERE id=?").run(uid, uid, reimbursement.id);
      }
      reimbursementCount++;
      const stage = advanceDemoReimbursement(reimbursement.id, index);
      if (stage === 'paid' && index % 2 === 0) archiveReimbursementVoucher(reimbursement.id, '模拟财务');
    }
  }

  const standaloneCount = Math.max(6, Math.round(orderCount / 5));
  for (let index = 0; index < standaloneCount; index++) {
    const employee = employees[(index + 2) % employees.length];
    const created = createReimbursement({
      employee,
      item: ['办公用品采购', '团队交通费', '会议茶歇', '样品快递费'][index % 4],
      amount: 48 + index * 23.5,
      advance_date: dateOffset(today, -(index * 5 % 90)),
      note: `后台模拟内务报销 · 批次 ${batch}`,
      invoice: index % 2 === 0 ? '模拟报销凭证.pdf' : '',
    });
    if (activeEmployees.length) {
      const uid = resolveEmployeeUidByName(db, employee);
      db.prepare("UPDATE reimbursements_simple SET employee_uid=?,department=COALESCE((SELECT department FROM employees WHERE catsco_uid=?),department) WHERE id=?").run(uid, uid, created.id);
    }
    reimbursementCount++;
    advanceDemoReimbursement(created.id, index + 1);
  }

  addAuditLog({ actorName: '后台模拟数据工具', actorUid, action: 'seed_demo_operations', entityType: 'admin_demo', entityId: batch, detail: { orders: orderCount, reimbursements: reimbursementCount, statuses: statusCounts } });
  return { batch, orders: orderCount, reimbursements: reimbursementCount, statusCounts };
}
