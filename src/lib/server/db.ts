import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { OrderDetail, Risk } from '$lib/types';

export const databasePath = resolve(process.env.DATABASE_PATH || './data/oa.db');
let instance: Database.Database | undefined;

const now = () => new Date().toISOString();
export function moneyToCents(value: unknown): number {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') throw new Error('INVALID_MONEY');
  const raw = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new Error('INVALID_MONEY');
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER / 100) throw new Error('INVALID_MONEY');
  return Math.round(amount * 100);
}

function migrate(db: Database.Database) {
  // V5 is an intentional, destructive schema cutover. The old prototype tables are not retained.
  const hasV5 = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_meta'").get()) &&
    Boolean(db.prepare("SELECT 1 FROM schema_meta WHERE key='schema_version' AND value IN ('9-cost-lifecycle-v2','10-acceptance-lifecycle')").get());
  if (!hasV5) {
    db.pragma('foreign_keys = OFF');
    db.exec(`DROP TABLE IF EXISTS integration_events; DROP TABLE IF EXISTS payments; DROP TABLE IF EXISTS invoices; DROP TABLE IF EXISTS cost_entries; DROP TABLE IF EXISTS status_history; DROP TABLE IF EXISTS audit_logs; DROP TABLE IF EXISTS attachments; DROP TABLE IF EXISTS acceptance_issues; DROP TABLE IF EXISTS procurement_offers; DROP TABLE IF EXISTS procurement_items; DROP TABLE IF EXISTS tasks; DROP TABLE IF EXISTS expenses; DROP TABLE IF EXISTS material_lines; DROP TABLE IF EXISTS quote_versions; DROP TABLE IF EXISTS order_workflows; DROP TABLE IF EXISTS order_members; DROP TABLE IF EXISTS user_roles; DROP TABLE IF EXISTS roles; DROP TABLE IF EXISTS users; DROP TABLE IF EXISTS departments; DROP TABLE IF EXISTS orders; DROP TABLE IF EXISTS schema_migrations; DROP TABLE IF EXISTS schema_meta;`);
    db.pragma('foreign_keys = ON');
  }
  if (hasV5 && db.prepare("SELECT 1 FROM schema_meta WHERE key='schema_version' AND value='9-cost-lifecycle-v2'").get()) {
    db.exec(`CREATE TABLE acceptance_issues_v10 AS SELECT * FROM acceptance_issues;
      DROP TABLE acceptance_issues;
      CREATE TABLE acceptance_issues(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, description TEXT NOT NULL, owner TEXT, due_date TEXT, status TEXT NOT NULL CHECK(status IN ('待整改','已整改','已验收')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT, resolution_note TEXT, verified_at TEXT, verified_by TEXT, reject_reason TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE);
      INSERT INTO acceptance_issues SELECT id,order_id,description,owner,due_date,status,created_at,updated_at,resolved_at,resolved_by,resolution_note,verified_at,verified_by,reject_reason,version FROM acceptance_issues_v10;
      DROP TABLE acceptance_issues_v10;`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, customer TEXT NOT NULL, name TEXT NOT NULL, owner TEXT, stage TEXT NOT NULL CHECK(stage IN ('报价中','执行中','待复验','已验收')), contract_amount INTEGER NOT NULL DEFAULT 0 CHECK(contract_amount >= 0), budget_cost INTEGER NOT NULL DEFAULT 0 CHECK(budget_cost >= 0), actual_cost INTEGER NOT NULL DEFAULT 0 CHECK(actual_cost >= 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system', updated_by TEXT NOT NULL DEFAULT 'system', version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), archived_at TEXT);
    CREATE TABLE IF NOT EXISTS quote_versions(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('草稿','已确认','已作废')), total INTEGER NOT NULL DEFAULT 0 CHECK(total >= 0), estimated_cost INTEGER NOT NULL DEFAULT 0 CHECK(estimated_cost >= 0), confirmed_at TEXT, proof TEXT, created_at TEXT NOT NULL, FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE, UNIQUE(order_id, version));
    CREATE TABLE IF NOT EXISTS material_lines(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, place TEXT, name TEXT NOT NULL, description TEXT, size TEXT, quantity NUMERIC NOT NULL CHECK(quantity > 0), unit TEXT NOT NULL, quote_unit INTEGER NOT NULL DEFAULT 0 CHECK(quote_unit >= 0), quote_total INTEGER NOT NULL DEFAULT 0 CHECK(quote_total >= 0), cost_unit INTEGER NOT NULL DEFAULT 0 CHECK(cost_unit >= 0), cost_total INTEGER NOT NULL DEFAULT 0 CHECK(cost_total >= 0), supplier TEXT, note TEXT NOT NULL DEFAULT '', FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS expenses(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, category TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), payment_type TEXT NOT NULL, payer TEXT, status TEXT NOT NULL CHECK(status IN ('待审核','待报销','已驳回','已报销')), proof TEXT, occurred_on TEXT NOT NULL, created_at TEXT NOT NULL, expense_no TEXT NOT NULL UNIQUE, note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT 'system', updated_by TEXT NOT NULL DEFAULT 'system', version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), archived_at TEXT, reviewed_by TEXT, reviewed_at TEXT, reject_reason TEXT, reimbursed_by TEXT, reimbursed_at TEXT, FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS audit_logs(id TEXT PRIMARY KEY, order_id TEXT, action TEXT NOT NULL, actor TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL, FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS status_history(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL, FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS order_workflows(order_id TEXT PRIMARY KEY, submitted INTEGER NOT NULL DEFAULT 0 CHECK(submitted IN (0,1)), selected_supplier TEXT, procurement_status TEXT NOT NULL DEFAULT '待选择' CHECK(procurement_status IN ('待选择','待定标','部分定标','已定标')), settled INTEGER NOT NULL DEFAULT 0 CHECK(settled IN (0,1)), FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0,1)), created_at TEXT NOT NULL, FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS procurement_items(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, name TEXT NOT NULL, budget INTEGER NOT NULL CHECK(budget >= 0), status TEXT NOT NULL DEFAULT '待询价' CHECK(status IN ('待询价','已定标')), created_at TEXT NOT NULL, supplier TEXT, awarded_amount INTEGER NOT NULL DEFAULT 0 CHECK(awarded_amount >= 0), awarded_at TEXT, FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS procurement_offers(id TEXT PRIMARY KEY, item_id TEXT NOT NULL, supplier TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), proof TEXT, status TEXT NOT NULL DEFAULT '待选定' CHECK(status IN ('待选定','已定标','未选定')), created_at TEXT NOT NULL, FOREIGN KEY(item_id) REFERENCES procurement_items(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS acceptance_issues(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, description TEXT NOT NULL, owner TEXT, due_date TEXT, status TEXT NOT NULL CHECK(status IN ('待整改','已整改','已验收')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT, resolution_note TEXT, verified_at TEXT, verified_by TEXT, reject_reason TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, related_type TEXT NOT NULL, related_id TEXT NOT NULL, uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS cost_entries(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL, cost_type TEXT NOT NULL CHECK(cost_type IN ('预计','承诺','实际','冲销')), amount INTEGER NOT NULL CHECK(amount >= 0), tax_amount INTEGER NOT NULL DEFAULT 0 CHECK(tax_amount >= 0), status TEXT NOT NULL CHECK(status IN ('有效','已冲销')), occurred_on TEXT, reversal_of TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE, UNIQUE(source_type, source_id, cost_type, reversal_of));
    CREATE TABLE IF NOT EXISTS invoices(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, invoice_no TEXT NOT NULL UNIQUE, amount INTEGER NOT NULL CHECK(amount > 0), status TEXT NOT NULL CHECK(status IN ('草稿','已开具','已作废')), issued_on TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), paid_on TEXT NOT NULL, reference_no TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS integration_events(id TEXT PRIMARY KEY, provider TEXT NOT NULL, event_type TEXT NOT NULL, external_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','processing','processed','failed')), error_message TEXT, received_at TEXT NOT NULL, processed_at TEXT, UNIQUE(provider, external_id));
    CREATE TABLE IF NOT EXISTS schema_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS departments(id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, status TEXT NOT NULL DEFAULT '正常', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(parent_id) REFERENCES departments(id));
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, department_id TEXT, email TEXT, phone TEXT, status TEXT NOT NULL DEFAULT '正常', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, FOREIGN KEY(department_id) REFERENCES departments(id));
    CREATE TABLE IF NOT EXISTS roles(id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS user_roles(user_id TEXT NOT NULL, role_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id, role_id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS order_members(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(order_id, user_id, role), FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id));
    CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_version_order ON quote_versions(order_id, version);
    CREATE INDEX IF NOT EXISTS idx_quotes_order_status ON quote_versions(order_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_materials_order ON material_lines(order_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_order ON expenses(order_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_order ON tasks(order_id);
    CREATE INDEX IF NOT EXISTS idx_procurement_order ON procurement_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_issues_order ON acceptance_issues(order_id);
    CREATE INDEX IF NOT EXISTS idx_issues_status_due ON acceptance_issues(status, due_date);
    CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_procurement_offers_item ON procurement_offers(item_id, status, amount);
    CREATE INDEX IF NOT EXISTS idx_audit_order ON audit_logs(order_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_status_history_entity ON status_history(entity_type, entity_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_status_history_order ON status_history(order_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_attachments_relation ON attachments(order_id, related_type, related_id, name);
    CREATE INDEX IF NOT EXISTS idx_attachments_order ON attachments(order_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cost_entries_order ON cost_entries(order_id, cost_type, status, occurred_on, created_at);
    CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id, status, issued_on);
    CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id, paid_on);
    CREATE INDEX IF NOT EXISTS idx_integration_events_status ON integration_events(status, received_at);
    CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id, status);
    CREATE INDEX IF NOT EXISTS idx_order_members_order ON order_members(order_id, role);
    CREATE INDEX IF NOT EXISTS idx_order_members_user ON order_members(user_id, order_id);
  `);

  db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(5,'optimized-mvp-schema-cutover',?)").run(now());
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(6,'facts-read-write-cutover',?)").run(now());
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(7,'finance-facts-only',?)").run(now());
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(8,'cost-lifecycle-model',?)").run(now());
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(9,'cost-lifecycle-v2',?)").run(now());
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(10,'acceptance-lifecycle',?)").run(now());
  db.prepare("INSERT OR REPLACE INTO schema_meta(key,value) VALUES('schema_version','10-acceptance-lifecycle')").run();
}

function seed(db: Database.Database) {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n;
  if (count) return;
  const created = now(), orderId = randomUUID();
  db.prepare('INSERT INTO orders(id,code,customer,name,owner,stage,contract_amount,budget_cost,actual_cost,created_at,updated_at,created_by,updated_by,version,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(orderId, 'ORD-2026-018', '中石油广东销售分公司', '英九茶庄采茶活动', '李海明', '执行中', 3989500, 2051687, 0, created, created, 'system', 'system', 1, null);
  db.prepare('INSERT INTO quote_versions VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), orderId, 'V1', '已确认', 3989500, 2051687, created, '真实报价成本表', created);
  db.prepare('INSERT INTO quote_versions VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), orderId, 'V2', '草稿', 4200000, 2200000, null, '待客户确认', created);
  const materials = [
    ['场外','停车场指引','桁架+黑底灯布结构（注意封边）','100*220cm',1,'个',28000,28000,10000,10000,'硕达喷绘','预算不够则换成木画架+KT板'],
    ['场外','主会场指引','桁架+黑底灯布结构（注意封边）','100*220cm',1,'个',28000,28000,10000,10000,'硕达喷绘',''],
    ['场外','签到处','桁架+黑底灯布结构（注意封边）','500*300cm',1,'个',90000,90000,52500,52500,'硕达喷绘',''],
    ['场内','会议厅指引','木画架+KT板','90*120cm',1,'套',12000,12000,4444,4444,'硕达喷绘',''],
    ['场内','LED画面','16:9画面','/',1,'张',90000,90000,0,0,'/',''],
    ['场内','讲台包围','kt板','192*120cm',1,'项',6500,6500,4147,4147,'硕达喷绘',''],
    ['场内','两侧展板','桁架+kt板or直接kt板','120*440cm',2,'套',30000,60000,9504,19008,'硕达喷绘',''],
    ['场内','舞台斜板','kt板','1050*47cm',1,'项',15000,15000,8883,8883,'硕达喷绘',''],
    ['场内','三角桌牌','参会人员名牌，铜版纸打印','21*10cm',120,'张',300,36000,150,18000,'硕达喷绘',''],
    ['场内','抽奖箱','抽奖箱（暂定）','40*40*40cm',1,'套',8000,8000,1728,1728,'硕达喷绘',''],
    ['场内','时间提示牌','kt板','100*80cm',1,'套',3000,3000,1440,1440,'硕达喷绘',''],
    ['场内','环节PPT','环节PPT','/',1,'项',40000,40000,0,0,'/','瑜鹏提供底图'],
    ['草坪部分','会议厅指引','木画架+KT板','90*120cm',1,'套',12000,12000,4444,4444,'硕达喷绘','草坪往会议厅方向'],
    ['草坪部分','帐篷','白色帐篷','300*300cm',10,'顶',24000,240000,15000,150000,'展韵工程',''],
    ['草坪部分','帐篷门楣','kt板','300*40cm',10,'张',5000,50000,2160,21600,'硕达喷绘','根据收集的游戏或互动名字'],
    ['草坪部分','帐篷挡板','kt板','300*70cm',10,'张',9000,90000,3780,37800,'硕达喷绘','主视觉延展'],
    ['草坪部分','木舞台背景板','桁架+双面黑底灯布结构（注意封边）','500*300cm',1,'套',150000,150000,66000,66000,'展韵工程',''],
    ['草坪部分','木舞台挡板','kt板','3960*56cm',1,'条',65000,65000,39917,39917,'展韵工程','分层3条'],
    ['草坪部分','中石油LOGO','黑底灯布（暂定）','800*800cm',1,'张',98000,98000,64000,64000,'展韵工程',''],
    ['草坪部分','空飘','定制空飘（直径1m）','100cm',4,'套',240000,960000,100000,400000,'展韵工程',''],
    ['采茶部分','道旗','注水道旗','',20,'套',24000,480000,8000,160000,'展韵工程','/'],
    ['采茶部分','指引牌','桁架+黑底灯布结构（注意封边）','100*220cm',2,'套',45000,90000,10000,20000,'硕达喷绘',''],
    ['采茶部分','区域示意','木画架+KT板','90*120cm',3,'套',12000,36000,4444,13332,'硕达喷绘','采茶区和炒茶区及装备领取区'],
    ['采茶部分','氛围物料','旗帜布横幅','/',20,'套',14000,280000,6000,120000,'李海明垫付',''],
    ['酒店部分','指引牌','木画架+KT板','90*120cm',1,'套',12000,12000,4444,4444,'展韵工程',''],
    ['摄像、摄影，活动回顾花絮视频剪辑','图片直播','图片直播','/',1,'机位',280000,280000,150000,150000,'明明乐摄影',''],
    ['摄像、摄影，活动回顾花絮视频剪辑','摄像','摄像','/',1,'机位',250000,250000,120000,120000,'明明乐摄影',''],
    ['摄像、摄影，活动回顾花絮视频剪辑','航拍','无人机航拍','/',1,'机位',300000,300000,100000,100000,'明明乐摄影',''],
    ['摄像、摄影，活动回顾花絮视频剪辑','剪辑师','花絮摄像，3分钟内活动回顾花絮视频剪辑','/',1,'机位',180000,180000,100000,100000,'明明乐摄影',''],
    ['其他','安装费+运输','项目汇总成本','/',1,'项',0,0,200000,200000,'展韵工程','Excel 汇总项'],
    ['其他','设计成本','项目汇总成本','/',1,'项',0,0,150000,150000,'瑜鹏自身','Excel 汇总项']
  ];
  const addMaterial = db.prepare('INSERT INTO material_lines(id,order_id,place,name,description,size,quantity,unit,quote_unit,quote_total,cost_unit,cost_total,supplier,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const row of materials) {
    const materialId = randomUUID();
    addMaterial.run(materialId, orderId, ...row);
    if (Number(row[9]) > 0) recordCost(db, { orderId, sourceType: 'material', sourceId: materialId, costType: '预计', amount: Number(row[9]), actor: 'system' });
  }
  const addExpense = db.prepare('INSERT INTO expenses(id,order_id,category,amount,payment_type,payer,status,proof,occurred_on,created_at,expense_no,note,created_by,updated_by,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  addExpense.run(randomUUID(), orderId, '现场物料运输', 280000, '员工垫付', '李海明', '待审核', '运输发票待补', '2026-08-25', created, 'EXP-2026-018-01', '等待补充运输发票', 'system', 'system', 1);
  const expenseId = randomUUID();
  addExpense.run(expenseId, orderId, '活动餐饮补充', 460000, '员工垫付', '李海明', '待报销', '付款截图已上传', '2026-08-26', created, 'EXP-2026-018-02', '真实项目补充费用', 'system', 'system', 1);
  recordCost(db, { orderId, sourceType: 'expense', sourceId: expenseId, costType: '实际', amount: 460000, actor: 'system', occurredOn: '2026-08-26' });
  db.prepare('INSERT INTO attachments(id,order_id,name,kind,related_type,related_id,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), orderId, '真实示例_中石油英九茶庄采茶活动报价成本表.xlsx', '报价成本表', 'order', orderId, '李海明', created);
  db.prepare('INSERT INTO attachments(id,order_id,name,kind,related_type,related_id,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), orderId, '付款截图.png', '付款凭证', 'expense', 'EXP-2026-018-02', '李海明', created);
  db.prepare('INSERT INTO procurement_items(id,order_id,name,budget,status,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(), orderId, '活动现场搭建', 1800000, '待询价', created);
  db.prepare('INSERT INTO acceptance_issues(id,order_id,description,owner,due_date,status,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), orderId, '补齐活动现场照片与交付清单', '李然', '2026-09-05', '待整改', created, created, 1);
  db.prepare('INSERT INTO invoices(id,order_id,invoice_no,amount,status,issued_on,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), orderId, 'INV-2026-018-01', 3989500, '已开具', '2026-08-20', 'system', created);
  db.prepare('INSERT INTO payments(id,order_id,amount,paid_on,reference_no,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), orderId, 2380000, '2026-08-28', 'DEMO-PAY-018', 'system', created);
  db.prepare('INSERT INTO order_workflows(order_id,submitted,selected_supplier,procurement_status,settled) VALUES(?,?,?,?,?)').run(orderId, 0, null, '待选择', 0);
  db.prepare('INSERT INTO status_history VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), orderId, 'order', orderId, null, '执行中', '初始化演示项目', 'system', null, created);
  const addTask = db.prepare('INSERT INTO tasks(id,order_id,title,done,created_at) VALUES(?,?,?,?,?)');
  for (const [title, done] of [['确认客户二次验收时间', 1], ['补齐运输发票凭证', 0], ['完成项目结算', 0]]) addTask.run(randomUUID(), orderId, title, done, created);
  audit(db, orderId, '创建订单');
  recomputeCost(db, orderId);
}

export function getDb(): Database.Database {
  if (!instance) {
    mkdirSync(dirname(databasePath), { recursive: true });
    instance = new Database(databasePath);
    instance.pragma('busy_timeout = 5000');
    instance.pragma('foreign_keys = ON');
    instance.pragma('journal_mode = WAL');
    instance.transaction(() => { migrate(instance!); seed(instance!); })();
  }
  return instance;
}

export function audit(db: Database.Database, orderId: string, action: string, actor = 'user', payload: unknown = {}) {
  db.prepare('INSERT INTO audit_logs VALUES(?,?,?,?,?,?)').run(randomUUID(), orderId, action, actor, JSON.stringify(payload), now());
}

export function touch(db: Database.Database, orderId: string, actor = 'system') {
  db.prepare('UPDATE orders SET updated_at=?,updated_by=?,version=version+1 WHERE id=?').run(now(), actor, orderId);
}

export function costSummary(db: Database.Database, orderId: string) {
  return db.prepare("SELECT cost_type, COALESCE(SUM(amount + tax_amount),0) AS amount FROM cost_entries WHERE order_id=? AND status='有效' GROUP BY cost_type").all(orderId) as { cost_type: string; amount: number }[];
}

export function recomputeCost(db: Database.Database, orderId: string): number {
  const actual = costSummary(db, orderId).find((row) => row.cost_type === '实际')?.amount ?? 0;
  db.prepare('UPDATE orders SET actual_cost=?,updated_at=?,version=version+1 WHERE id=?').run(actual, now(), orderId);
  return actual;
}

export function recordCost(db: Database.Database, values: { orderId: string; sourceType: string; sourceId: string; costType: '预计' | '承诺' | '实际' | '冲销'; amount: number; actor: string; occurredOn?: string }) {
  const existing = db.prepare('SELECT id,status,amount FROM cost_entries WHERE source_type=? AND source_id=? AND cost_type=? AND reversal_of IS NULL').get(values.sourceType, values.sourceId, values.costType) as { id: string; status: string; amount: number } | undefined;
  if (existing) {
    if (existing.status === '已冲销' && existing.amount === values.amount) db.prepare("UPDATE cost_entries SET status='有效',created_by=?,created_at=? WHERE id=?").run(values.actor, now(), existing.id);
    return;
  }
  db.prepare('INSERT INTO cost_entries(id,order_id,source_type,source_id,cost_type,amount,tax_amount,status,occurred_on,created_by,created_at) VALUES(?,?,?,?,?,?,0,\'有效\',?,?,?)').run(randomUUID(), values.orderId, values.sourceType, values.sourceId, values.costType, values.amount, values.occurredOn || now().slice(0, 10), values.actor, now());
}

export function reverseCost(db: Database.Database, sourceType: string, sourceId: string, actor: string) {
  db.prepare("UPDATE cost_entries SET status='已冲销',created_by=?,created_at=? WHERE source_type=? AND source_id=? AND status='有效'").run(actor, now(), sourceType, sourceId);
}

export function findOrder(db: Database.Database, idOrCode: string): { id: string } | undefined {
  return db.prepare('SELECT id FROM orders WHERE id=? OR code=?').get(idOrCode, idOrCode) as { id: string } | undefined;
}

export function getOrderDetail(db: Database.Database, idOrCode: string): OrderDetail | undefined {
  const order = db.prepare('SELECT * FROM orders WHERE id=? OR code=?').get(idOrCode, idOrCode) as OrderDetail | undefined;
  if (!order) return;
  order.quotes = db.prepare('SELECT * FROM quote_versions WHERE order_id=? ORDER BY created_at DESC').all(order.id) as OrderDetail['quotes'];
  order.materials = db.prepare('SELECT * FROM material_lines WHERE order_id=?').all(order.id) as OrderDetail['materials'];
  order.expenses = db.prepare('SELECT * FROM expenses WHERE order_id=? ORDER BY created_at DESC').all(order.id) as OrderDetail['expenses'];
  order.audit = db.prepare('SELECT * FROM audit_logs WHERE order_id=? ORDER BY created_at DESC').all(order.id) as OrderDetail['audit'];
  order.status_history = db.prepare('SELECT * FROM status_history WHERE order_id=? ORDER BY created_at DESC').all(order.id) as OrderDetail['status_history'];
  order.cost_entries = db.prepare('SELECT * FROM cost_entries WHERE order_id=? ORDER BY occurred_on DESC,created_at DESC').all(order.id) as OrderDetail['cost_entries'];
  order.cost_summary = costSummary(db, order.id);
  order.invoices = db.prepare('SELECT * FROM invoices WHERE order_id=? ORDER BY created_at DESC').all(order.id) as OrderDetail['invoices'];
  order.payments = db.prepare('SELECT * FROM payments WHERE order_id=? ORDER BY paid_on DESC,created_at DESC').all(order.id) as OrderDetail['payments'];
  order.attachments = db.prepare('SELECT * FROM attachments WHERE order_id=? ORDER BY created_at DESC').all(order.id) as OrderDetail['attachments'];
  order.workflow = (db.prepare(`SELECT w.*, COALESCE((SELECT SUM(amount) FROM invoices WHERE order_id=? AND status='已开具'),0) AS invoice, COALESCE((SELECT SUM(amount) FROM payments WHERE order_id=?),0) AS payment FROM order_workflows w WHERE w.order_id=?`).get(order.id, order.id, order.id) ?? { submitted: 0, selected_supplier: null, procurement_status: '待选择', invoice: 0, settled: 0 }) as OrderDetail['workflow'];
  order.tasks = db.prepare('SELECT * FROM tasks WHERE order_id=? ORDER BY created_at').all(order.id) as OrderDetail['tasks'];
  order.procurement_items = db.prepare('SELECT * FROM procurement_items WHERE order_id=? ORDER BY created_at DESC').all(order.id) as OrderDetail['procurement_items'];
  for (const item of order.procurement_items) item.offers = db.prepare('SELECT * FROM procurement_offers WHERE item_id=? ORDER BY amount').all(item.id) as typeof item.offers;
  order.acceptance_issues = db.prepare('SELECT * FROM acceptance_issues WHERE order_id=? ORDER BY created_at DESC').all(order.id) as OrderDetail['acceptance_issues'];
  order.risk = riskState(order);
  return order;
}

function riskState(order: OrderDetail): Risk {
  const reasons: string[] = [];
  const openIssues = order.acceptance_issues.filter((x) => x.status === '待整改').length;
  const pendingTasks = order.tasks.filter((x) => !x.done).length;
  const pendingProcurement = order.procurement_items.filter((x) => x.status !== '已定标').length;
  if (openIssues) reasons.push(`有${openIssues}项验收问题未关闭`);
  if (pendingTasks) reasons.push(`有${pendingTasks}项任务未完成`);
  if (!order.quotes.some((x) => x.status === '已确认')) reasons.push('没有已确认报价');
  if (pendingProcurement) reasons.push(`有${pendingProcurement}项采购未定标`);
  if (order.actual_cost > order.budget_cost) reasons.push('实际成本超过预算');
  return { is_risk: Boolean(reasons.length), level: reasons.length >= 3 ? '高' : reasons.length ? '中' : '低', reasons };
}

export const isoNow = now;
export const uuid = randomUUID;
