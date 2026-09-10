import { listOrders } from '$lib/server/order-db';
import * as XLSX from 'xlsx';
import type { RequestHandler } from './$types';

const columns: Record<string, string> = {
  code: '订单编号', order_date: '订单日期', customer_name: '客户', project_name: '项目', project_owner: '项目负责人', service_name: '订单内容', quantity: '数量', unit: '单位', quote_amount: '总报价', cost_amount: '总成本', created_by: '录入人', status: '状态', note: '备注', reimbursement_status: '报销状态'
};
const csv = (value: unknown) => {
  const text = String(value ?? '');
  // Prevent spreadsheet formula injection while preserving the exported value.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};
export const GET: RequestHandler = ({ url }) => {
  const params = url.searchParams;
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const creator = params.get('creator') || '';
  const owner = params.get('owner') || '';
  const customer = params.get('customer') || '';
  const project = params.get('project') || '';
  const selectedParam = params.get('columns');
  const selected: string[] = (selectedParam || Object.keys(columns).join(',')).split(',').filter((key: string) => Boolean(columns[key]));
  const ids = new Set((params.get('ids') || '').split(',').filter(Boolean));
  const hasIds = params.has('ids');
  const orders = listOrders().filter((row) => {
    const value = row as Record<string, unknown>;
    return (!hasIds || ids.has(String(value.id))) && (!from || String(value.order_date) >= from) && (!to || String(value.order_date) <= to) && (!creator || String(value.created_by) === creator) && (!owner || String(value.project_owner) === owner) && (!customer || String(value.customer_id) === customer) && (!project || String(value.project_id) === project);
  });
  const rows = orders.map((row) => selected.reduce<Record<string, unknown>>((out, key) => {
    const value = (row as Record<string, unknown>)[key];
    out[columns[key]] = key.endsWith('_amount') ? Number(value || 0) / 100 : value;
    return out;
  }, {}));
  const sheet = XLSX.utils.json_to_sheet(rows, { header: selected.map((key) => columns[key]) });
  sheet['!cols'] = selected.map((key) => ({ wch: Math.max(12, Math.min(36, columns[key].length + 8)) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '订单结算表');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return new Response(buffer, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.xlsx"` } });
};
