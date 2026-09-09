export interface OrderSummary {
  id: string;
  is_extra?: number;
  code: string;
  customer: string;
  name: string;
  owner: string;
  stage: string;
  contract_amount: number;
  budget_cost: number;
  actual_cost: number;
  created_at: string;
  updated_at: string;
}

export interface QuoteVersion {
  id: string;
  order_id?: string;
  version: string;
  status: string;
  total: number;
  estimated_cost: number;
  confirmed_at?: string | null;
  proof: string;
  created_at: string;
}

export interface Task { id: string; order_id?: string; title: string; done: number; created_at: string }
export interface Material { id: string; place: string; name: string; description: string; size: string; quantity: number; unit: string; quote_unit: number; quote_total: number; cost_unit: number; cost_total: number; supplier: string; note: string }
export interface Expense { id: string; expense_no: string; category: string; amount: number; payment_type: string; payer: string; status: string; proof: string; occurred_on: string; note: string; created_at: string; reviewed_by?: string | null; reviewed_at?: string | null; reject_reason?: string | null; reimbursed_by?: string | null; reimbursed_at?: string | null; version?: number }
export interface AcceptanceIssue { id: string; description: string; owner: string; due_date: string; status: '待整改' | '已整改' | '已验收'; created_at: string; updated_at?: string; resolved_at?: string | null; resolved_by?: string | null; resolution_note?: string | null; verified_at?: string | null; verified_by?: string | null; reject_reason?: string | null; version?: number }
export interface ProcurementOffer { id: string; item_id: string; supplier: string; amount: number; proof: string; status: string; created_at: string }
export interface ProcurementItem { id: string; name: string; budget: number; status: string; supplier: string | null; awarded_amount: number; awarded_at: string | null; created_at: string; offers?: ProcurementOffer[] }
export interface AuditLog { id: string; action: string; actor: string; payload: string; created_at: string }
export interface StatusHistory { id: string; order_id: string; entity_type: string; entity_id: string; from_status: string | null; to_status: string; action: string; actor: string; reason: string | null; created_at: string }
export interface CostEntry { id: string; order_id: string; source_type: string; source_id: string; cost_type: string; amount: number; tax_amount: number; status: string; occurred_on: string | null; reversal_of?: string | null; created_by: string; created_at: string }
export interface Invoice { id: string; order_id: string; invoice_no: string; amount: number; status: string; issued_on: string | null; created_by: string; created_at: string }
export interface Payment { id: string; order_id: string; amount: number; paid_on: string; reference_no: string | null; created_by: string; created_at: string }
export interface Attachment { id: string; name: string; kind: string; related_type: string; related_id: string; uploaded_by: string; created_at: string }
export interface Workflow { submitted: number; selected_supplier: string | null; procurement_status: string; invoice: number; settled: number; payment: number }
export interface Risk { is_risk: boolean; level: string; reasons: string[] }

export interface CostSummary { cost_type: string; amount: number }

export interface OrderDetail extends OrderSummary {
  quotes: QuoteVersion[];
  tasks: Task[];
  materials: Material[];
  expenses: Expense[];
  acceptance_issues: AcceptanceIssue[];
  procurement_items: ProcurementItem[];
  audit: AuditLog[];
  status_history: StatusHistory[];
  cost_entries: CostEntry[];
  cost_summary: CostSummary[];
  invoices: Invoice[];
  payments: Payment[];
  attachments: Attachment[];
  workflow: Workflow;
  risk: Risk;
}

export interface WorkspaceData { orders: OrderSummary[]; order: OrderDetail | null; view: string; }

export type JsonRecord = Record<string, unknown>;
