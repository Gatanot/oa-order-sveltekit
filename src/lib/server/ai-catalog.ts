import { getOrderDb, createCatalogSource, importCatalog, moneyToCents, addAuditLog } from '$lib/server/order-db';
import type { CurrentIdentity } from '$lib/server/identity';

const textSchema = { type: 'string', maxLength: 2000 };
const kindSchema = { type: 'string', enum: ['quote', 'cost'] };
const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const commonFields = Object.fromEntries(['name', 'category', 'specification', 'unit', 'item_no', 'tax_rate', 'remark'].map((key) => [key, textSchema]));
const moneySchema = { type: 'string', pattern: '^\\d+(\\.\\d{1,2})?$', description: '人民币元，非负，最多两位小数；建议使用字符串。' };
const rowSchema = { oneOf: [
  objectSchema({ ...commonFields, cost_unit: moneySchema, cost_unit_excl_tax: moneySchema, min_quantity: textSchema }, ['name', 'cost_unit']),
  objectSchema({ ...commonFields, price_incl_tax: moneySchema, price_excl_tax: moneySchema, max_quote_unit: moneySchema, project_name: textSchema, estimated_quantity: textSchema }, ['name', 'price_incl_tax'])
] };

export const catalogTools = [
  { name: 'list_sources', description: '分页查询报价库/成本库来源。quote 对应客户，cost 对应厂商。', inputSchema: objectSchema({ kind: kindSchema, q: textSchema, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, offset: { type: 'integer', minimum: 0, default: 0 } }) },
  { name: 'search_items', description: '按资料库、名称、分类或规格搜索有效条目。金额全部返回人民币元字符串。', inputSchema: objectSchema({ kind: kindSchema, source_id: textSchema, q: textSchema, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, offset: { type: 'integer', minimum: 0, default: 0 } }, ['kind']) },
  { name: 'create_source', description: '新建资料库。默认 dry_run=true 仅预览；false 才写入。不支持复制或替换。', inputSchema: objectSchema({ kind: kindSchema, owner_name: textSchema, dry_run: { type: 'boolean', default: true } }, ['kind', 'owner_name']) },
  { name: 'upsert_items', description: '批量新增/更新条目（1–100 行）。默认只预览；提交需 dry_run=false。更新按自然键匹配，行内可选字段未传将清空/置零，不是局部 PATCH。成本键=分类+名称+厂商+规格；报价键=分类+名称+客户+项目+规格+预估数量。客户/厂商强制取资料库 owner_name，禁止跨库挪动条目。', inputSchema: objectSchema({ source_id: textSchema, rows: { type: 'array', minItems: 1, maxItems: 100, items: rowSchema }, dry_run: { type: 'boolean', default: true } }, ['source_id', 'rows']) }
];

export class CatalogToolError extends Error {
  constructor(public code: string, message: string, public status = 400, public path?: string) { super(message); }
}
function invalid(path: string, message: string): never { throw new CatalogToolError('VALIDATION_ERROR', message, 400, path); }
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, '必须是 JSON 对象');
  return value as Record<string, unknown>;
}
function allowed(data: Record<string, unknown>, fields: string[], path = 'arguments') {
  for (const key of Object.keys(data)) if (!fields.includes(key)) invalid(`${path}.${key}`, '不支持的字段');
}
function string(value: unknown, path: string, required = false): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > 2000 || (required && !value.trim())) invalid(path, '必须是有效文本（最多 2000 字符）');
  return value.trim();
}
function kind(value: unknown): 'quote' | 'cost' {
  if (value !== 'quote' && value !== 'cost') invalid('arguments.kind', 'kind 必须是 quote 或 cost');
  return value;
}
function dryRun(data: Record<string, unknown>): boolean {
  if (data.dry_run !== undefined && typeof data.dry_run !== 'boolean') invalid('arguments.dry_run', '必须是布尔值');
  return data.dry_run !== false;
}
function pagination(data: Record<string, unknown>) {
  const limit = data.limit ?? 20;
  const offset = data.offset ?? 0;
  if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 100) invalid('arguments.limit', 'limit 必须是 1–100 的整数');
  if (!Number.isSafeInteger(offset) || Number(offset) < 0) invalid('arguments.offset', 'offset 必须是非负整数');
  return { limit: Number(limit), offset: Number(offset) };
}
const tableFor = (libraryKind: string) => libraryKind === 'cost' ? 'catalog_cost_items' : 'catalog_quote_items';
type Source = { id: string; kind: 'quote' | 'cost'; owner_name: string };
function sourceById(id: string): Source {
  const source = getOrderDb().prepare('SELECT id,kind,owner_name FROM catalog_sources WHERE id=? AND active=1').get(id) as Source | undefined;
  if (!source) throw new CatalogToolError('SOURCE_NOT_FOUND', '资料库不存在或已停用', 404);
  return source;
}
const yuan = (cents: unknown) => (Number(cents) / 100).toFixed(2);

export function runCatalogTool(tool: string, input: unknown, identity: CurrentIdentity) {
  const data = object(input, 'arguments');
  const db = getOrderDb();
  if (tool === 'list_sources' || tool === 'search_items') {
    const searching = tool === 'search_items';
    allowed(data, searching ? ['kind', 'source_id', 'q', 'limit', 'offset'] : ['kind', 'q', 'limit', 'offset']);
    const libraryKind = searching || data.kind !== undefined ? kind(data.kind) : undefined;
    const q = string(data.q, 'arguments.q');
    const { limit, offset } = pagination(data);
    const clauses = ['active=1'];
    const values: string[] = [];
    if (!searching && libraryKind) { clauses.push('kind=?'); values.push(libraryKind); }
    if (searching && data.source_id !== undefined) {
      const source = sourceById(string(data.source_id, 'arguments.source_id', true));
      if (source.kind !== libraryKind) invalid('arguments.source_id', '资料库类型不匹配');
      clauses.push('source_id=?'); values.push(source.id);
    }
    if (q) {
      clauses.push(searching ? '(instr(lower(name),lower(?))>0 OR instr(lower(category),lower(?))>0 OR instr(lower(specification),lower(?))>0)' : 'instr(lower(owner_name),lower(?))>0');
      values.push(...(searching ? [q, q, q] : [q]));
    }
    const table = searching ? tableFor(libraryKind!) : 'catalog_sources';
    const where = clauses.join(' AND ');
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get(...values) as { count: number }).count;
    // 不暴露 raw_data 和来源文件等非本工具需要的内容。
    const columns = !searching ? 'id,kind,owner_name,updated_at' : libraryKind === 'cost'
      ? 'id,source_id,item_no,category,name,specification,unit,supplier_name,cost_unit,cost_unit_excl_tax,tax_rate,min_quantity,remark'
      : 'id,source_id,item_no,category,name,specification,unit,customer_name,project_name,estimated_quantity,price_incl_tax,price_excl_tax,max_price,tax_rate,remark';
    const rows = db.prepare(`SELECT ${columns} FROM ${table} WHERE ${where} ORDER BY ${searching ? 'name' : 'owner_name'},id LIMIT ? OFFSET ?`).all(...values, limit, offset) as Record<string, unknown>[];
    if (searching) for (const row of rows) {
      for (const key of libraryKind === 'cost' ? ['cost_unit', 'cost_unit_excl_tax'] : ['price_incl_tax', 'price_excl_tax', 'max_price']) row[key] = yuan(row[key]);
      // 与录入字段名称一致。
      if (libraryKind === 'quote') { row.max_quote_unit = row.max_price; delete row.max_price; }
    }
    return { items: rows, total, limit, offset, ...(searching ? { currency: 'CNY', money_unit: 'yuan' } : {}) };
  }
  if (tool === 'create_source') {
    allowed(data, ['kind', 'owner_name', 'dry_run']);
    const libraryKind = kind(data.kind);
    const owner = string(data.owner_name, 'arguments.owner_name', true);
    const preview = dryRun(data);
    return db.transaction(() => {
      if (db.prepare('SELECT 1 FROM catalog_sources WHERE kind=? AND owner_name=?').get(libraryKind, owner)) throw new CatalogToolError('CONFLICT', '同类型同公司资料库已存在，请先查询并使用现有 source_id', 409);
      if (preview) return { dry_run: true, source: { kind: libraryKind, owner_name: owner } };
      const created = createCatalogSource({ kind: libraryKind, owner_name: owner, source_method: 'ai_tool' }) as Source;
      addAuditLog({ actorUid: identity.uid, actorName: identity.displayName, action: 'create', entityType: 'catalog_source', entityId: created.id, detail: { channel: 'ai_tool', tool } });
      return { dry_run: false, source: created };
    })();
  }
  if (tool === 'upsert_items') {
    allowed(data, ['source_id', 'rows', 'dry_run']);
    const sourceId = string(data.source_id, 'arguments.source_id', true);
    const preview = dryRun(data);
    if (!Array.isArray(data.rows) || data.rows.length < 1 || data.rows.length > 100) invalid('arguments.rows', '每次必须提交 1–100 行');
    const inputRows = data.rows;
    return db.transaction(() => {
      const source = sourceById(sourceId);
      const moneyFields = source.kind === 'cost' ? ['cost_unit', 'cost_unit_excl_tax'] : ['price_incl_tax', 'price_excl_tax', 'max_quote_unit'];
      const textFields = [...Object.keys(commonFields), ...(source.kind === 'cost' ? ['min_quantity'] : ['project_name', 'estimated_quantity'])];
      const seen = new Set<string>();
      let inserted = 0;
      let updated = 0;
      const rows = inputRows.map((raw, index) => {
        const path = `arguments.rows[${index}]`;
        const row = object(raw, path);
        allowed(row, [...textFields, ...moneyFields], path);
        const normalized: Record<string, unknown> = {};
        for (const field of textFields) normalized[field] = string(row[field], `${path}.${field}`, field === 'name');
        normalized.unit ||= '项';
        normalized.item_no ||= String(index + 1);
        const primary = source.kind === 'cost' ? 'cost_unit' : 'price_incl_tax';
        if (row[primary] === undefined) invalid(`${path}.${primary}`, '必须显式提供含税单价，避免误写成零');
        for (const field of moneyFields) {
          const value = row[field] === undefined ? '0' : row[field];
          if (typeof value !== 'string') invalid(`${path}.${field}`, '金额必须为人民币元字符串');
          try { normalized[field] = yuan(moneyToCents(value)); }
          catch { invalid(`${path}.${field}`, '金额必须非负且最多两位小数'); }
        }
        const keyFields = source.kind === 'cost'
          ? ['category', 'name', 'supplier_name', 'specification']
          : ['category', 'name', 'customer_name', 'project_name', 'specification', 'estimated_quantity'];
        // 与现有资料库的自然键保持一致；不接受 AI 指定客户/厂商身份。
        const keyRow: Record<string, unknown> = { ...normalized, supplier_name: source.owner_name, customer_name: source.owner_name };
        const keyValues = keyFields.map((field) => keyRow[field]);
        const key = JSON.stringify(keyValues);
        if (seen.has(key)) invalid(path, '同一请求包含重复条目');
        seen.add(key);
        const existing = db.prepare(`SELECT id,source_id FROM ${tableFor(source.kind)} WHERE ${keyFields.map((field) => `${field}=?`).join(' AND ')}`).get(...keyValues) as { id: string; source_id: string | null } | undefined;
        if (existing && existing.source_id !== source.id) throw new CatalogToolError('CROSS_SOURCE_CONFLICT', '条目已属于其他资料库，禁止跨库覆盖', 409, path);
        if (existing) updated++; else inserted++;
        return normalized;
      });
      const result = { dry_run: preview, source_id: source.id, kind: source.kind, inserted, updated, rows, currency: 'CNY', money_unit: 'yuan', warning: '按自然键整行写入；未提供的可选文本/金额字段将清空/置零。预览不保留数据，也不锁定版本，提交时会重新校验。' };
      if (!preview) {
        importCatalog(rows, source.id, { actorUid: identity.uid, actorName: identity.displayName, replace: false });
        addAuditLog({ actorUid: identity.uid, actorName: identity.displayName, action: 'ai_catalog_upsert', entityType: 'catalog_source', entityId: source.id, detail: { channel: 'ai_tool', tool, inserted, updated } });
      }
      return result;
    })();
  }
  throw new CatalogToolError('UNKNOWN_TOOL', '未知工具，请先 GET 当前接口获取工具定义', 400);
}
