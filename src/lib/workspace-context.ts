import type { ProcurementItem, OrderDetail, OrderSummary, WorkspaceData } from '$lib/types';

export type View = 'dashboard' | 'orders' | 'quotes' | 'procure' | 'accept' | 'finance' | 'expenses';
export const views: View[] = ['dashboard', 'orders', 'quotes', 'procure', 'accept', 'finance', 'expenses'];
export const WORKSPACE_CONTEXT = 'orbit-workspace';

export type ModalKind = 'order' | 'task' | 'expense' | 'quote' | 'material' | 'procurement' | 'offer' | 'issue' | 'finance';

export interface WorkspaceState {
  orders: OrderSummary[];
  order: OrderDetail | null;
  busy: boolean;
  message: string;
  errorMessage: string;
}

export interface WorkspaceContext {
  state: WorkspaceState;
  data: WorkspaceData;
  selectView: (view: View) => Promise<void>;
  choose: (code: string) => Promise<void>;
  reload: (code?: string) => Promise<void>;
  mutate: (path: string, body: Record<string, unknown>, success: string) => Promise<void>;
  award: (item: ProcurementItem, offer: { id: string; supplier: string; amount: number }) => Promise<void>;
  attachProof: (expenseId: string) => Promise<void>;
  toggleTask: (task: { id: string; done: number }) => Promise<void>;
  rejectExpense: (expense: { id: string }) => Promise<void>;
  resetDemo: () => Promise<void>;
  open: (kind: ModalKind, item?: ProcurementItem | null) => void;
}
