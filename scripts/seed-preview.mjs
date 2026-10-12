import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';

const origin = new URL(process.env.PREVIEW_ORIGIN || 'http://127.0.0.1:5180');
assert(['127.0.0.1', 'localhost'].includes(origin.hostname), 'Preview seeding requires a local server');
const databasePath = resolve('data/preview-demo.db');
assert(existsSync(databasePath), 'Start the preview server with DATABASE_PATH=data/preview-demo.db and open /orders first');
const db = new Database(databasePath);
db.pragma('foreign_keys = ON');
const marker = 'local-preview-v1';

async function request(path, options = {}) {
  const response = await fetch(new URL(path, origin), {
    ...options,
    headers: { origin: origin.origin, ...options.headers }
  });
  const result = await response.json();
  assert(response.ok, JSON.stringify(result));
  return result;
}

try {
  const existing = db.prepare("SELECT id FROM audit_logs WHERE action='seed_local_preview' AND entity_id=?").get(marker);
  if (!existing) {
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders_simple').get().count, 0, 'Use an empty preview database');
    const employees = [
      [9001, 'chenchen', '陈晨', '商务', 'manager'],
      [9002, 'liulin', '刘琳', '设计', 'designer'],
      [9003, 'zhaoran', '赵然', '设计', 'designer'],
      [9004, 'zhoumin', '周敏', '策划', 'planner'],
      [9005, 'wangjie', '王杰', '执行', 'executor'],
      [9006, 'linxiao', '林晓', '内务', 'finance'],
      [9007, 'zhangning', '张宁', '商务', 'owner']
    ];
    const timestamp = new Date().toISOString();
    db.transaction(() => {
      const insert = db.prepare(`INSERT OR IGNORE INTO employees
        (catsco_uid,username,display_name,department,role,active,created_at,updated_at)
        VALUES(?,?,?,?,?,1,?,?)`);
      for (const employee of employees) insert.run(...employee, timestamp, timestamp);
    })();

    const catalogs = await request('/admin?/catalogs', {
      method: 'POST', body: new URLSearchParams({ count: '2' })
    });
    assert(catalogs.type === 'success', JSON.stringify(catalogs));
    const operations = await request('/admin?/operations', {
      method: 'POST', body: new URLSearchParams({ count: '36' })
    });
    assert(operations.type === 'success', JSON.stringify(operations));

    const source = await request('/api/catalog/sources', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'quote', owner_name: '客户标准报价（模拟）' })
    });
    const rows = [
      ['广告制作', '喷绘制作', '平方米', 68, '户外高清喷绘布'],
      ['广告制作', '车贴裱板', '平方米', 95, '黑胶车贴裱 5mm PVC 板'],
      ['广告制作', 'KT板写真', '平方米', 78, '室内写真裱 KT 板'],
      ['展示物料', '门型展架画面', '套', 128, '80x180cm PP 合成纸'],
      ['展示物料', '易拉宝', '套', 168, '铝合金易拉宝含画面'],
      ['广告制作', 'UV软膜', '平方米', 118, 'UV 软膜灯箱画面'],
      ['印刷物料', '宣传单', '张', 0.6, '157g 铜版纸双面彩印'],
      ['印刷物料', '折页', '张', 1.25, '200g 铜版纸三折页'],
      ['印刷物料', '画册', '本', 18.8, 'A4 骑马钉 20P'],
      ['印刷物料', '手提袋', '个', 8.6, '250g 白卡纸四色印刷'],
      ['展示物料', '台卡', '个', 58, 'A5 亚克力台卡'],
      ['执行服务', '安装人工', '人次', 480, '市区普通墙面安装']
    ];
    const csv = '\uFEFFcategory,name,unit,quote_unit,specification\n' + rows.map(row => row.join(',')).join('\n');
    const form = new FormData();
    form.set('file', new Blob([csv], { type: 'text/csv' }), 'preview-quotes.csv');
    form.set('source_id', source.data.id);
    form.set('mode', 'import');
    await request('/api/catalog/import', { method: 'POST', body: form });

    // Link generated records to real demo employees and to the current preview identity.
    db.transaction(() => {
      const orders = db.prepare('SELECT id FROM orders_simple ORDER BY created_at,id').all();
      const update = db.prepare(`UPDATE orders_simple SET created_by_uid=?,designer=?,designer_uid=?,
        planner=?,planner_uid=?,execution_company=? WHERE id=?`);
      orders.forEach((order, index) => update.run(
        employees[index % employees.length][0], index % 2 ? '赵然' : '刘琳', index % 2 ? 9003 : 9002,
        '周敏', 9004, index % 2 ? '华彩喷印' : '嘉印物料', order.id
      ));
      const reimbursements = db.prepare('SELECT id FROM reimbursements_simple ORDER BY created_at,id').all();
      const updateReimbursement = db.prepare('UPDATE reimbursements_simple SET employee=?,employee_uid=? WHERE id=?');
      reimbursements.forEach((item, index) => {
        const employee = employees[index % employees.length];
        updateReimbursement.run(employee[2], employee[0], item.id);
      });
      const ownRows = db.prepare('SELECT MIN(id) AS id FROM reimbursements_simple GROUP BY status').all();
      for (const row of ownRows) updateReimbursement.run('catsco', 826, row.id);
      db.prepare(`INSERT INTO audit_logs(id,actor_name,actor_uid,action,entity_type,entity_id,created_at)
        VALUES(?, 'Local preview', 826, 'seed_local_preview', 'preview', ?, ?)`)
        .run(marker, marker, timestamp);
    })();
  }
  console.log(JSON.stringify({
    orders: db.prepare('SELECT COUNT(*) AS count FROM orders_simple').get().count,
    reimbursements: db.prepare('SELECT COUNT(*) AS count FROM reimbursements_simple').get().count,
    ownReimbursements: db.prepare('SELECT COUNT(*) AS count FROM reimbursements_simple WHERE employee_uid=826').get().count,
    catalogItems: db.prepare('SELECT COUNT(*) AS count FROM catalog_items WHERE active=1').get().count,
    employees: db.prepare('SELECT COUNT(*) AS count FROM employees').get().count
  }, null, 2));
} finally {
  db.close();
}
