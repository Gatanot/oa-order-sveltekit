import { createHash } from 'node:crypto';
import { getOrderDb, getOrderById, createOrder, updateOrder, setOrderEmployees, resolveOrderEmployeeUid, moneyToCents, addAuditLog } from '$lib/server/order-db';
import { employeeRoles, hasAnyRole, orderCreateRoles, orderManageRoles, orderViewAllRoles, getEmployeeDisplayName, type CurrentIdentity } from '$lib/server/identity';

/** 本机无认证代录身份：由本机入口以 role=admin、uid=-1 构造，不代表任何员工或固定管理员。 */
export type AiServiceIdentity = CurrentIdentity & { kind: 'local_entry' };

const textSchema = { type: 'string', maxLength: 2000 };
const dateSchema = { type: 'string', format: 'date', description: 'YYYY-MM-DD' };
const moneySchema = { type: 'string', pattern: '^\\d+(\\.\\d{1,2})?$', description: '人民币元字符串，非负，最多两位小数' };
const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const pagingSchema = { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, offset: { type: 'integer', minimum: 0, default: 0 } };
const lineFields = { name: textSchema, catalog_id: { type: ['string', 'null'] }, unit: textSchema, quantity: { type: 'number', exclusiveMinimum: 0 }, unit_price: moneySchema };
const productsSchema = { type: 'array', description: '全量产品明细；替换时必须携带要保留的 unit/specification/remark，未填分别默认项/空/空。输出 subtotal 是只读字段，不要回传。', minItems: 1, maxItems: 100, items: objectSchema({ ...lineFields, specification: textSchema, remark: textSchema }, ['name', 'quantity', 'unit_price']) };
const costsSchema = { type: 'array', description: '全量成本明细；空数组清空成本。未填 unit/vendor 默认项/空。输出 subtotal 是只读字段，不要回传。', maxItems: 100, items: objectSchema({ ...lineFields, vendor: textSchema }, ['name', 'quantity', 'unit_price']) };
const orderFields = {
  project_id: textSchema,
  created_by_uid: { type: 'integer', minimum: 1, description: '创建人归属员工 UID。代录创建时必填；员工必须已开通在职，姓名由员工档案确定，不接受 created_by 文本。' },
  order_date: dateSchema, delivery_date: { ...textSchema, description: 'YYYY-MM-DD，空字符串清除交付日期' },
  contact: textSchema, customer_department: textSchema, execution_company: textSchema, note: textSchema,
  designer_uid: { type: ['integer', 'null'], minimum: 1 }, planner_uid: { type: ['integer', 'null'], minimum: 1 },
  products: productsSchema, costs: costsSchema
};
const orderCreateSchema = objectSchema(orderFields, ['project_id', 'created_by_uid', 'products']);
export const orderTools = [
  { name: 'search_orders', description: '分页搜索当前用户可见订单。普通用户仅能看自己创建/参与的订单，返回金额为元字符串。', inputSchema: objectSchema({ ...pagingSchema, q: textSchema, project_id: textSchema, status: { type: 'string', enum: ['已提交', '已完成'] }, order_date_from: dateSchema, order_date_to: dateSchema }) },
  { name: 'get_order', description: '读取订单明细、可编辑状态和 revision。不可见和不存在统一返回 ORDER_NOT_FOUND。', inputSchema: objectSchema({ order_id: textSchema }, ['order_id']) },
  { name: 'list_references', description: '分页搜索客户、项目、所有在职已开通员工（可按 role 筛选）、执行公司。人员 UID 仅用于订单归属/指派，不代表代录身份。', inputSchema: objectSchema({ resource: { type: 'string', enum: ['customers', 'projects', 'employees', 'execution_companies'] }, q: textSchema, customer_id: textSchema, role: { type: 'string', enum: [...employeeRoles] }, ...pagingSchema }, ['resource']) },
  { name: 'create_order', description: '创建订单，默认仅预览。必须通过 order.created_by_uid 指定归属员工（已开通在职，不限岗位，姓名取自员工档案），不接受 created_by 文本。正式提交必须 dry_run=false 并提供 1–80 字符 idempotency_key；同一代录请求同 key 同内容可安全重试，不同内容冲突。状态由服务端确定。明细价格显式填入，不自动取资料库最新价。', inputSchema: objectSchema({ order: orderCreateSchema, idempotency_key: { type: 'string', minLength: 1, maxLength: 80 }, dry_run: { type: 'boolean', default: true } }, ['order']) },
  { name: 'batch_create_orders', description: '批量创建 1–50 个订单，默认仅预览。一个外层 immediate 事务原子执行，任一条失败全部回滚；正式提交每条必须提供互不重复的 idempotency_key。每条复用 create_order 的校验与幂等规则，错误 path 会带 entries 索引。预览不写入。', inputSchema: objectSchema({ entries: { type: 'array', minItems: 1, maxItems: 50, items: objectSchema({ order: orderCreateSchema, idempotency_key: { type: 'string', minLength: 1, maxLength: 80 } }, ['order']) }, dry_run: { type: 'boolean', default: true } }, ['entries']) },
  { name: 'update_order', description: '局部修改订单，未提供字段保持原值。products/costs 若提供则全量替换；UID 显式 null 清除指派。可用 created_by_uid 重新归属创建人，姓名自动取自员工档案；未提供时保留原归属与姓名快照。不接受 created_by 文本/结款/状态。必须提供 get_order 的 expected_revision；数据变化返回 REVISION_CONFLICT。默认仅预览。', inputSchema: objectSchema({ order_id: textSchema, expected_revision: textSchema, changes: { ...objectSchema(orderFields), minProperties: 1 }, dry_run: { type: 'boolean', default: true } }, ['order_id', 'expected_revision', 'changes']) }
];
export class OrderToolError extends Error {
  constructor(public code: string, message: string, public status = 400, public path?: string) { super(message); }
}
function invalid(path: string, message: string): never { throw new OrderToolError('VALIDATION_ERROR', message, 400, path); }
function obj(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, '必须是 JSON 对象');
  return value as Record<string, unknown>;
}
function allowed(data: Record<string, unknown>, keys: string[], path = 'arguments') {
  for (const key of Object.keys(data)) if (!keys.includes(key)) invalid(`${path}.${key}`, '不支持的字段');
}
function str(value: unknown, path: string, required = false): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > 2000 || (required && !value.trim())) invalid(path, '必须是有效文本（最多 2000 字符）');
  return value.trim();
}
function date(value: unknown, path: string, empty = false): string {
  if (empty && value === '') return '';
  const result = str(value, path, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result) invalid(path, '日期必须为有效 YYYY-MM-DD');
  return result;
}
function pagination(data: Record<string, unknown>) {
  const limit = data.limit ?? 20, offset = data.offset ?? 0;
  if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 100) invalid('arguments.limit', 'limit 必须是 1–100 的整数');
  if (!Number.isSafeInteger(offset) || Number(offset) < 0) invalid('arguments.offset', 'offset 必须为非负整数');
  return { limit: Number(limit), offset: Number(offset) };
}
function preview(data: Record<string, unknown>) {
  if (data.dry_run !== undefined && typeof data.dry_run !== 'boolean') invalid('arguments.dry_run', '必须是布尔值');
  return data.dry_run !== false;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
}
const yuan = (cents: unknown) => (Number(cents) / 100).toFixed(2);
function isParticipant(row: Record<string, any>, uid: number) { return row.created_by_uid === uid || row.designer_uid === uid || row.planner_uid === uid; }
export function orderPermissions(identity: CurrentIdentity) {
  // 本机代录是受信任的本机无认证入口，角色固定 admin，因此拥有全部订单能力。
  if (isServiceAgent(identity)) return { read: true, create: true, view_all: true, manage_all: true, edit_scope: 'all' as const };
  return { read: identity.active && identity.role !== 'pending', create: hasAnyRole(identity, orderCreateRoles), view_all: hasAnyRole(identity, orderViewAllRoles), manage_all: hasAnyRole(identity, orderManageRoles), edit_scope: hasAnyRole(identity, orderManageRoles) ? 'all' : 'participating' };
}
/** 本机代录身份由本机入口构造；legacy 为浏览器绑定的当前用户。 */
function isServiceAgent(identity: CurrentIdentity): identity is AiServiceIdentity {
  return (identity as Partial<AiServiceIdentity>).kind === 'local_entry';
}
/** 本机代录审计不冒充员工或管理员：actor_uid 为 null、actor_name 为空串。 */
function auditActor(identity: CurrentIdentity) {
  return isServiceAgent(identity) ? { actorUid: null, actorName: '' } : { actorUid: identity.uid, actorName: identity.displayName };
}
/**
 * 解析订单创建人归属。代录必须显式提供员工档案 UID，不接受姓名文本；
 * legacy 当前用户身份只能以本人为创建人。
 */
function resolveCreator(identity: CurrentIdentity, uid: unknown, path: string): { uid: number; name: string } {
  const service = isServiceAgent(identity);
  if (uid === undefined || uid === null) {
    if (service) invalid(path, '代录创建订单必须提供 created_by_uid（员工档案 UID），不接受 created_by 姓名文本');
    return { uid: identity.uid, name: identity.displayName };
  }
  if (!Number.isSafeInteger(uid) || Number(uid) < 1) invalid(path, 'created_by_uid 必须是正整数员工 UID');
  const value = Number(uid);
  if (!service) {
    if (value !== identity.uid) throw new OrderToolError('FORBIDDEN', '当前用户身份只能以本人作为创建人', 403, path);
    return { uid: identity.uid, name: identity.displayName };
  }
  const row = getOrderDb().prepare('SELECT catsco_uid,display_name FROM employees WHERE catsco_uid=? AND active=1 AND role<>\'pending\'').get(value) as { catsco_uid: number; display_name: string } | undefined;
  if (!row) invalid(path, 'created_by_uid 必须是已开通的在职员工（active=1 且非 pending），不限岗位');
  return { uid: row.catsco_uid, name: row.display_name };
}
function access(id: string, identity: CurrentIdentity, edit = false) {
  const row = getOrderById(id);
  if (!row || (!hasAnyRole(identity, orderViewAllRoles) && !isParticipant(row, identity.uid))) throw new OrderToolError('ORDER_NOT_FOUND', '订单不存在或不可见', 404);
  if (edit && !hasAnyRole(identity, orderManageRoles) && !isParticipant(row, identity.uid)) throw new OrderToolError('FORBIDDEN', '没有编辑此订单权限', 403);
  return row;
}
function revision(id: string) {
  const db = getOrderDb();
  return hash({
    order: db.prepare('SELECT * FROM orders_simple WHERE id=?').get(id),
    products: db.prepare('SELECT * FROM order_products WHERE order_id=? ORDER BY position,id').all(id),
    costs: db.prepare('SELECT * FROM order_costs WHERE order_id=? ORDER BY position,id').all(id)
  });
}
function publicOrder(row: Record<string, any>, identity: CurrentIdentity) {
  const result: Record<string, unknown> = {};
  for (const key of ['id', 'code', 'project_id', 'customer_id', 'customer_name', 'project_name', 'service_name', 'order_date', 'delivery_date', 'contact', 'customer_department', 'execution_company', 'note', 'status', 'payment_status', 'created_at', 'created_by', 'created_by_uid', 'designer', 'designer_uid', 'planner', 'planner_uid', 'is_extra']) result[key] = row[key] ?? null;
  result.quote_amount = yuan(row.quote_amount);
  result.cost_amount = yuan(row.cost_amount);
  for (const type of ['products', 'costs']) result[type] = (row[type] || []).map((line: Record<string, unknown>) => {
    const item: Record<string, unknown> = {};
    for (const key of ['catalog_id', 'name', 'unit', 'quantity', ...(type === 'products' ? ['specification', 'remark'] : ['vendor'])]) item[key] = line[key] ?? (key === 'catalog_id' ? null : '');
    item.unit_price = Number(line.unit_price).toFixed(2);
    item.subtotal = Number(line.subtotal ?? Number(line.quantity) * Number(line.unit_price)).toFixed(2);
    return item;
  });
  result.currency = 'CNY'; result.money_unit = 'yuan';
  result.revision = revision(String(row.id));
  result.can_edit = Boolean(row.created_by_uid) && (hasAnyRole(identity, orderManageRoles) || isParticipant(row, identity.uid));
  return result;
}
function lines(value: unknown, type: 'products' | 'costs', path: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 100 || (type === 'products' && !value.length)) invalid(path, type === 'products' ? '产品需为 1–100 行数组' : '成本需为 0–100 行数组');
  return value.map((raw, index) => {
    const p = `${path}[${index}]`, row = obj(raw, p);
    allowed(row, ['catalog_id', 'name', 'unit', 'quantity', 'unit_price', ...(type === 'products' ? ['specification', 'remark'] : ['vendor'])], p);
    const name = str(row.name, `${p}.name`, true);
    if (typeof row.quantity !== 'number' || !Number.isFinite(row.quantity) || row.quantity <= 0) invalid(`${p}.quantity`, '数量必须为有限正数');
    if (typeof row.unit_price !== 'string') invalid(`${p}.unit_price`, '单价必须为人民币元字符串');
    let cents: number;
    try { cents = moneyToCents(row.unit_price); } catch { invalid(`${p}.unit_price`, '金额必须非负且最多两位小数'); }
    if (!Number.isSafeInteger(Math.round(row.quantity * cents))) invalid(p, '行金额超出安全范围');
    let catalogId: string | null = null;
    if (row.catalog_id !== null && row.catalog_id !== undefined) {
      catalogId = str(row.catalog_id, `${p}.catalog_id`, true);
      const table = type === 'products' ? 'catalog_quote_items' : 'catalog_cost_items';
      if (!getOrderDb().prepare(`SELECT 1 FROM ${table} WHERE id=? AND active=1`).get(catalogId)) invalid(`${p}.catalog_id`, '对应资料库条目不存在或已停用');
    }
    const result: Record<string, unknown> = { catalog_id: catalogId, name, unit: str(row.unit, `${p}.unit`) || '项', quantity: row.quantity, unit_price: yuan(cents) };
    for (const key of type === 'products' ? ['specification', 'remark'] : ['vendor']) result[key] = str(row[key], `${p}.${key}`);
    return result;
  });
}
function normalizeOrder(input: Record<string, unknown>, path: string, identity: CurrentIdentity, existing?: Record<string, any>) {
  allowed(input, Object.keys(orderFields), path);
  if (existing && !Object.keys(input).length) invalid(path, '至少提供一个修改字段');
  const order: Record<string, any> = {};
  // 更新仅覆盖显式给出的字段，绕开旧网页 PATCH 未传字段被清空的语义。
  for (const key of ['project_id', 'order_date', 'delivery_date', 'contact', 'customer_department', 'execution_company', 'note', 'designer_uid', 'planner_uid', 'designer', 'planner', 'products', 'costs', 'status', 'payment_status', 'created_by', 'created_by_uid']) {
    if (existing && existing[key] !== undefined) order[key] = existing[key];
  }
  for (const key of ['project_id', 'contact', 'customer_department', 'execution_company', 'note']) {
    if (!existing || Object.hasOwn(input, key)) order[key] = str(input[key], `${path}.${key}`, key === 'project_id');
  }
  if (!getOrderDb().prepare('SELECT 1 FROM projects_simple WHERE id=?').get(order.project_id)) invalid(`${path}.project_id`, '项目不存在，请先查询项目参考数据');
  if (!existing || Object.hasOwn(input, 'order_date')) order.order_date = input.order_date === undefined ? new Date().toISOString().slice(0, 10) : date(input.order_date, `${path}.order_date`);
  if (!existing || Object.hasOwn(input, 'delivery_date')) order.delivery_date = input.delivery_date === undefined ? '' : date(input.delivery_date, `${path}.delivery_date`, true);
  // 创建人归属：创建必填（legacy 可默认本人）；更新省略则保留原 UID 与原始姓名快照。
  if (!existing) {
    const creator = resolveCreator(identity, input.created_by_uid, `${path}.created_by_uid`);
    order.created_by_uid = creator.uid; order.created_by = creator.name;
  } else if (Object.hasOwn(input, 'created_by_uid') && input.created_by_uid !== existing.created_by_uid) {
    const creator = resolveCreator(identity, input.created_by_uid, `${path}.created_by_uid`);
    order.created_by_uid = creator.uid; order.created_by = creator.name;
  }
  for (const role of ['designer', 'planner'] as const) {
    const key = `${role}_uid`;
    if (!existing || Object.hasOwn(input, key)) {
      const uid = input[key] ?? null;
      if (uid !== null && (!Number.isSafeInteger(uid) || Number(uid) < 1)) invalid(`${path}.${key}`, '指派 UID 必须为正整数或 null');
      try { order[key] = resolveOrderEmployeeUid(uid, role); } catch { invalid(`${path}.${key}`, '指派人员不存在、已停用或岗位不符'); }
      order[role] = order[key] ? getEmployeeDisplayName(order[key]) || '' : '';
    }
  }
  for (const type of ['products', 'costs'] as const) {
    if (!existing || Object.hasOwn(input, type)) order[type] = lines(input[type] === undefined && type === 'costs' ? [] : input[type], type, `${path}.${type}`);
    // 未改变的历史明细不重新验证资料库 active，保留订单价格快照。
  }
  for (const type of ['products', 'costs']) {
    let total = 0;
    for (const line of order[type]) {
      const subtotal = Math.round(Number(line.quantity) * Number(line.unit_price) * 100);
      if (!Number.isSafeInteger(subtotal) || subtotal < 0) invalid(`${path}.${type}`, '明细金额超出安全范围');
      total += subtotal;
    }
    if (!Number.isSafeInteger(total)) invalid(`${path}.${type}`, '合计金额超出安全范围');
  }
  return order;
}
function previewOrder(order: Record<string, any>) {
  const project = getOrderDb().prepare('SELECT p.id,p.name,p.customer_id,c.name AS customer_name FROM projects_simple p JOIN customers_simple c ON c.id=p.customer_id WHERE p.id=?').get(order.project_id) as Record<string, unknown>;
  const result: Record<string, unknown> = { ...order, customer_id: project.customer_id, customer_name: project.customer_name, project_name: project.name, currency: 'CNY', money_unit: 'yuan' };
  for (const type of ['products', 'costs']) {
    const rows = order[type] as Record<string, unknown>[];
    result[type] = rows.map((line) => ({ ...line, unit_price: Number(line.unit_price).toFixed(2), subtotal: yuan(Math.round(Number(line.quantity) * Number(line.unit_price) * 100)) }));
    result[type === 'products' ? 'quote_amount' : 'cost_amount'] = yuan(rows.reduce((sum, line) => sum + Math.round(Number(line.quantity) * Number(line.unit_price) * 100), 0));
  }
  return result;
}
function listReferences(data: Record<string, unknown>) {
  allowed(data, ['resource', 'q', 'customer_id', 'role', 'limit', 'offset']);
  const resource = str(data.resource, 'arguments.resource', true);
  const q = str(data.q, 'arguments.q');
  const { limit, offset } = pagination(data);
  let from: string, columns: string, sort: string;
  const where: string[] = [], values: string[] = [];
  if (resource === 'customers') { from = 'customers_simple'; columns = 'id,name'; sort = 'name,id'; }
  else if (resource === 'projects') {
    from = 'projects_simple p JOIN customers_simple c ON c.id=p.customer_id';
    columns = 'p.id,p.name,p.customer_id,c.name AS customer_name,p.status'; sort = 'p.name,p.id';
    if (data.customer_id !== undefined) { where.push('p.customer_id=?'); values.push(str(data.customer_id, 'arguments.customer_id', true)); }
  } else if (resource === 'employees') { from = 'employees'; columns = 'catsco_uid,display_name,department,role'; sort = 'display_name,catsco_uid'; where.push("active=1 AND role<>'pending'"); }
  else if (resource === 'execution_companies') { from = 'execution_companies'; columns = 'id,name'; sort = 'name,id'; }
  else invalid('arguments.resource', '不支持的参考数据类型');
  if (data.customer_id !== undefined && resource !== 'projects') invalid('arguments.customer_id', '该筛选仅适用于项目');
  if (data.role !== undefined) {
    if (resource !== 'employees') invalid('arguments.role', '该筛选仅适用于员工');
    const role = str(data.role, 'arguments.role', true);
    if (!(employeeRoles as readonly string[]).includes(role)) invalid('arguments.role', '不支持的员工岗位');
    where.push('role=?'); values.push(role);
  }
  if (q) { where.push(`instr(lower(${resource === 'employees' ? 'display_name' : resource === 'projects' ? 'p.name' : 'name'}),lower(?))>0`); values.push(q); }
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const db = getOrderDb();
  return { items: db.prepare(`SELECT ${columns} FROM ${from}${clause} ORDER BY ${sort} LIMIT ? OFFSET ?`).all(...values, limit, offset), total: (db.prepare(`SELECT COUNT(*) AS n FROM ${from}${clause}`).get(...values) as { n: number }).n, limit, offset };
}

type CreateReplay = { request_hash: string; order_id: string };
const exists = (db: ReturnType<typeof getOrderDb>, table: string) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
/** 本机代录使用独立全局幂等表（键全局唯一，不含 agent 维度，也不读取旧 AI 服务表）；legacy 保持旧表。 */
function findReplay(identity: CurrentIdentity, key: string): CreateReplay | undefined {
  const db = getOrderDb();
  // 只读取已存在的表：预览和重放不创建表、不写订单、不写审计。
  if (isServiceAgent(identity)) {
    if (!exists(db, 'order_entry_requests')) return undefined;
    return db.prepare('SELECT request_hash,order_id FROM order_entry_requests WHERE request_key=?').get(key) as CreateReplay | undefined;
  }
  if (!exists(db, 'ai_order_requests')) return undefined;
  return db.prepare('SELECT request_hash,order_id FROM ai_order_requests WHERE actor_uid=? AND request_key=?').get(identity.uid, key) as CreateReplay | undefined;
}
function rememberCreate(identity: CurrentIdentity, key: string, requestHash: string, orderId: string) {
  const db = getOrderDb();
  if (isServiceAgent(identity)) {
    db.exec('CREATE TABLE IF NOT EXISTS order_entry_requests(request_key TEXT PRIMARY KEY,request_hash TEXT NOT NULL,order_id TEXT NOT NULL)');
    db.prepare('INSERT INTO order_entry_requests(request_key,request_hash,order_id) VALUES(?,?,?)').run(key, requestHash, orderId);
    return;
  }
  db.exec('CREATE TABLE IF NOT EXISTS ai_order_requests(actor_uid INTEGER NOT NULL,request_key TEXT NOT NULL,request_hash TEXT NOT NULL,order_id TEXT NOT NULL,PRIMARY KEY(actor_uid,request_key))');
  db.prepare('INSERT INTO ai_order_requests(actor_uid,request_key,request_hash,order_id) VALUES(?,?,?,?)').run(identity.uid, key, requestHash, orderId);
}
/** create_order 与 batch_create_orders 共用的创建实现；调用方必须已开启事务。 */
function createOrderWithin(data: Record<string, unknown>, identity: CurrentIdentity, path: string, dry: boolean) {
  const rawOrder = obj(data.order, `${path}.order`);
  const key = str(data.idempotency_key, `${path}.idempotency_key`, !dry);
  if (key.length > 80) invalid(`${path}.idempotency_key`, '幂等键最长 80 字符');
  const requestHash = hash(stable(rawOrder));
  if (key) {
    const replay = findReplay(identity, key);
    if (replay) {
      if (replay.request_hash !== requestHash) throw new OrderToolError('IDEMPOTENCY_CONFLICT', '同一幂等键不能用于不同订单内容', 409, `${path}.idempotency_key`);
      const previous = getOrderById(replay.order_id);
      if (!previous) throw new OrderToolError('IDEMPOTENCY_CONFLICT', '此请求已创建的订单已删除，不能用同一键重新创建', 409, `${path}.idempotency_key`);
      // 重放只读：不写订单、不改变归属、不写审计。
      return { dry_run: dry, replayed: true, order: publicOrder(access(replay.order_id, identity), identity) };
    }
  }
  const order = normalizeOrder(rawOrder, `${path}.order`, identity);
  order.status = '已提交'; order.payment_status = '未结款';
  if (dry) return { dry_run: true, replayed: false, order: previewOrder(order) };
  const created = createOrder(order);
  setOrderEmployees(String(created.id), order.created_by_uid, order.designer_uid, order.planner_uid);
  if (key) rememberCreate(identity, key, requestHash, String(created.id));
  addAuditLog({
    ...auditActor(identity), action: 'create', entityType: 'order', entityId: String(created.id),
    detail: { created_by_uid: order.created_by_uid }
  });
  return { dry_run: false, replayed: false, order: publicOrder(access(String(created.id), identity), identity) };
}
function batchCreateOrders(data: Record<string, unknown>, identity: CurrentIdentity) {
  allowed(data, ['entries', 'dry_run']);
  if (!Array.isArray(data.entries) || data.entries.length < 1 || data.entries.length > 50) invalid('arguments.entries', 'entries 必须是 1–50 条数组');
  const dry = preview(data);
  const entries = data.entries;
  const db = getOrderDb();
  const execute = () => {
    const seen = new Set<string>();
    const prepared = entries.map((raw, index) => {
      const path = `arguments.entries[${index}]`;
      const entry = obj(raw, path);
      allowed(entry, ['order', 'idempotency_key'], path);
      const key = str(entry.idempotency_key, `${path}.idempotency_key`, !dry);
      if (key.length > 80) invalid(`${path}.idempotency_key`, '幂等键最长 80 字符');
      if (key) {
        if (seen.has(key)) invalid(`${path}.idempotency_key`, '同一批次内幂等键不能重复');
        seen.add(key);
      }
      return { path, entry };
    });
    if (dry) {
      const items = prepared.map(({ path, entry }) => createOrderWithin(entry, identity, path, true));
      return { dry_run: true, items, total: items.length };
    }
    // 正式写入前先用预览模式验证全部条目，任一条失败则不进入任何写入。
    for (const { path, entry } of prepared) createOrderWithin(entry, identity, path, true);
    const items = prepared.map(({ path, entry }) => createOrderWithin(entry, identity, path, false));
    return { dry_run: false, items, total: items.length };
  };
  // 正式写入使用唯一外层 immediate 事务：任一条失败全部回滚；预览不写。
  return dry ? db.transaction(execute)() : db.transaction(execute).immediate();
}

export function runOrderTool(tool: string, input: unknown, identity: CurrentIdentity) {
  if (!identity.active || identity.role === 'pending') throw new OrderToolError('FORBIDDEN', '账户未开通或已停用', 403);
  const data = obj(input, 'arguments');
  const db = getOrderDb();
  if (tool === 'list_references') return listReferences(data);
  if (tool === 'get_order') {
    allowed(data, ['order_id']);
    return db.transaction(() => publicOrder(access(str(data.order_id, 'arguments.order_id', true), identity), identity))();
  }
  if (tool === 'search_orders') {
    allowed(data, ['q', 'project_id', 'status', 'order_date_from', 'order_date_to', 'limit', 'offset']);
    const { limit, offset } = pagination(data);
    const clauses: string[] = [], values: (string | number)[] = [];
    if (!hasAnyRole(identity, orderViewAllRoles)) { clauses.push('(o.created_by_uid=? OR o.designer_uid=? OR o.planner_uid=?)'); values.push(identity.uid, identity.uid, identity.uid); }
    if (data.project_id !== undefined) { clauses.push('o.project_id=?'); values.push(str(data.project_id, 'arguments.project_id', true)); }
    if (data.status !== undefined) {
      if (!['已提交', '已完成'].includes(String(data.status))) invalid('arguments.status', '状态不正确');
      clauses.push('o.status=?'); values.push(String(data.status));
    }
    for (const [key, op] of [['order_date_from', '>='], ['order_date_to', '<=']]) if (data[key] !== undefined) { clauses.push(`o.order_date${op}?`); values.push(date(data[key], `arguments.${key}`)); }
    const q = str(data.q, 'arguments.q');
    if (q) { clauses.push('(instr(lower(o.code),lower(?))>0 OR instr(lower(o.service_name),lower(?))>0 OR instr(lower(c.name),lower(?))>0 OR instr(lower(p.name),lower(?))>0)'); values.push(q, q, q, q); }
    const from = `orders_simple o JOIN customers_simple c ON c.id=o.customer_id JOIN projects_simple p ON p.id=o.project_id${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}`;
    return db.transaction(() => ({
      items: (db.prepare(`SELECT o.id FROM ${from} ORDER BY o.order_date DESC,o.created_at DESC,o.id LIMIT ? OFFSET ?`).all(...values, limit, offset) as { id: string }[]).map(({ id }) => publicOrder(access(id, identity), identity)),
      total: (db.prepare(`SELECT COUNT(*) AS n FROM ${from}`).get(...values) as { n: number }).n, limit, offset
    }))();
  }
  if (tool === 'create_order') {
    if (!hasAnyRole(identity, orderCreateRoles)) throw new OrderToolError('FORBIDDEN', '没有创建订单权限', 403);
    allowed(data, ['order', 'idempotency_key', 'dry_run']);
    const dry = preview(data);
    return db.transaction(() => createOrderWithin(data, identity, 'arguments', dry)).immediate();
  }
  if (tool === 'batch_create_orders') {
    if (!hasAnyRole(identity, orderCreateRoles)) throw new OrderToolError('FORBIDDEN', '没有创建订单权限', 403);
    return batchCreateOrders(data, identity);
  }
  if (tool === 'update_order') {
    allowed(data, ['order_id', 'expected_revision', 'changes', 'dry_run']);
    const id = str(data.order_id, 'arguments.order_id', true);
    const expected = str(data.expected_revision, 'arguments.expected_revision', true);
    const dry = preview(data);
    return db.transaction(() => {
      const existing = access(id, identity, true);
      if (!existing.created_by_uid) throw new OrderToolError('ORDER_CREATOR_UID_MISSING', '订单缺少原创建人 UID，需人工处理', 409);
      if (expected !== revision(id)) throw new OrderToolError('REVISION_CONFLICT', '订单已变化，请重新读取详情后决定修改', 409);
      const changes = obj(data.changes, 'arguments.changes');
      const order = normalizeOrder(changes, 'arguments.changes', identity, existing);
      // 未重新归属时保留不可编辑的原始姓名快照，不能因 hydrate 显示名变化覆盖。
      if (!Object.hasOwn(changes, 'created_by_uid') || changes.created_by_uid === existing.created_by_uid) {
        const original = db.prepare('SELECT created_by FROM orders_simple WHERE id=?').get(id) as { created_by: string };
        order.created_by = original.created_by;
      }
      if (dry) return { dry_run: true, order_id: id, expected_revision: expected, order: { ...previewOrder(order), id, revision: expected, can_edit: true } };
      updateOrder(id, order);
      setOrderEmployees(id, order.created_by_uid, order.designer_uid, order.planner_uid);
      addAuditLog({ ...auditActor(identity), action: 'update', entityType: 'order', entityId: id, detail: { fields: Object.keys(changes), from_revision: expected, created_by_uid: order.created_by_uid } });
      return { dry_run: false, order: publicOrder(getOrderById(id)!, identity) };
    }).immediate();
  }
  throw new OrderToolError('UNKNOWN_TOOL', '未知订单工具，请先获取工具定义');
}
