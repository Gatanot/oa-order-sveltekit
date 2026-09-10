import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { audit, isoNow, recordCost, touch } from './db';

type OrderState = { id: string; stage: string; contract_amount: number; submitted: number; settled: number; invoice: number; payment: number };

// The company uses the order register for delivery execution. Collection/invoicing is
// deliberately outside this OA: it is not an order completion condition.
export const ORDER_STAGES = ['报价中', '执行中', '待复验', '已验收'] as const;
const transitions: Record<string, string[]> = {
  报价中: ['执行中'],
  执行中: ['待复验'],
  待复验: ['执行中', '已验收'],
  已验收: []
};

function state(db: Database.Database, orderId: string): OrderState {
  const result = db.prepare(`
    SELECT o.id, o.stage, o.contract_amount, w.submitted, w.settled,
      COALESCE((SELECT SUM(amount) FROM invoices WHERE order_id=o.id AND status='已开具'),0) AS invoice,
      COALESCE((SELECT SUM(amount) FROM payments WHERE order_id=o.id),0) AS payment
    FROM orders o JOIN order_workflows w ON w.order_id = o.id WHERE o.id=?
  `).get(orderId) as OrderState | undefined;
  if (!result) throw new Error('ORDER_WORKFLOW_NOT_FOUND');
  return result;
}

function setStage(db: Database.Database, orderId: string, stage: string, actor: string, action: string) {
  const current = state(db, orderId);
  if (stage === current.stage) return current;
  if (!ORDER_STAGES.includes(stage as typeof ORDER_STAGES[number])) throw new Error('INVALID_STAGE');
  if (!transitions[current.stage]?.includes(stage)) throw new Error('INVALID_STAGE_TRANSITION');
  if (stage === '执行中') {
    const quote = db.prepare("SELECT 1 FROM quote_versions WHERE order_id=? AND status='已确认' LIMIT 1").get(orderId);
    if (!quote) throw new Error('QUOTE_CONFIRM_REQUIRED');
  }
  if (stage === '待复验') {
    if (!current.submitted) throw new Error('ACCEPTANCE_SUBMISSION_REQUIRED');
  }
  if (stage === '已验收') {
    if (!current.submitted || current.stage !== '待复验') throw new Error('ACCEPTANCE_SUBMISSION_REQUIRED');
    const open = (db.prepare("SELECT COUNT(*) AS n FROM acceptance_issues WHERE order_id=? AND status='待整改'").get(orderId) as { n: number }).n;
    if (open) throw new Error('OPEN_ACCEPTANCE_ISSUES');
  }
  const changedAt = isoNow();
  db.prepare('UPDATE orders SET stage=?,updated_at=?,updated_by=?,version=version+1 WHERE id=?').run(stage, changedAt, actor, orderId);
  db.prepare('INSERT INTO status_history VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), orderId, 'order', orderId, current.stage, stage, action, actor, null, changedAt);
  audit(db, orderId, action, actor, { from: current.stage, to: stage });
  return state(db, orderId);
}

export function submitAcceptance(db: Database.Database, orderId: string, actor: string) {
  const current = state(db, orderId);
  if (current.stage !== '执行中') throw new Error('ACCEPTANCE_SUBMIT_STAGE_REQUIRED');
  if (current.submitted) throw new Error('ACCEPTANCE_ALREADY_SUBMITTED');
  const open = (db.prepare("SELECT COUNT(*) AS n FROM acceptance_issues WHERE order_id=? AND status='待整改'").get(orderId) as { n: number }).n;
  if (open) throw new Error('OPEN_ACCEPTANCE_ISSUES');
  db.prepare("UPDATE order_workflows SET submitted=1 WHERE order_id=?").run(orderId);
  return setStage(db, orderId, '待复验', actor, '提交验收复验');
}

export function returnAcceptance(db: Database.Database, orderId: string, actor: string) {
  const current = state(db, orderId);
  if (current.stage !== '待复验' || !current.submitted) throw new Error('ACCEPTANCE_RETURN_NOT_ALLOWED');
  db.prepare("UPDATE order_workflows SET submitted=0 WHERE order_id=?").run(orderId);
  const result = setStage(db, orderId, '执行中', actor, '验收退回整改');
  return result;
}

export function passAcceptance(db: Database.Database, orderId: string, actor: string) {
  const open = (db.prepare("SELECT COUNT(*) AS n FROM acceptance_issues WHERE order_id=? AND status<>'已验收'").get(orderId) as { n: number }).n;
  if (open) throw new Error('OPEN_ACCEPTANCE_ISSUES');
  return setStage(db, orderId, '已验收', actor, '复验通过');
}

export function settleProject(db: Database.Database, orderId: string, actor: string) {
  const current = state(db, orderId);
  if (current.stage !== '已验收') throw new Error('ACCEPTANCE_NOT_PASSED');
  if (current.settled) throw new Error('ALREADY_SETTLED');
  db.prepare('UPDATE order_workflows SET settled=1 WHERE order_id=?').run(orderId);
  return setStage(db, orderId, '已验收', actor, '项目结算');
}

export function recordFinance(db: Database.Database, orderId: string, values: { invoice?: number; payment?: number }, actor: string) {
  const current = state(db, orderId);
  if (current.stage === '已回款') throw new Error('FINANCE_CLOSED');
  const invoice = values.invoice ?? current.invoice;
  const payment = values.payment ?? current.payment;
  if (invoice < current.invoice || payment < current.payment) throw new Error('FINANCE_TOTAL_CANNOT_DECREASE');
  if (invoice < 0 || payment < 0) throw new Error('INVALID_MONEY');
  if (invoice > current.contract_amount) throw new Error('INVOICE_EXCEEDS_CONTRACT');
  if (payment > invoice) throw new Error('PAYMENT_EXCEEDS_INVOICE');
  const oldInvoice = current.invoice, oldPayment = current.payment;
  if (invoice === oldInvoice && payment === oldPayment) throw new Error('NO_FINANCE_CHANGE');
  if (invoice > oldInvoice) db.prepare('INSERT INTO invoices(id,order_id,invoice_no,amount,status,issued_on,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), orderId, `INV-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`, invoice - oldInvoice, '已开具', isoNow().slice(0, 10), actor, isoNow());
  if (payment > oldPayment) db.prepare('INSERT INTO payments(id,order_id,amount,paid_on,created_by,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(), orderId, payment - oldPayment, isoNow().slice(0, 10), actor, isoNow());
  audit(db, orderId, '更新开票与回款', actor, { invoice, payment, invoice_delta: invoice - oldInvoice, payment_delta: payment - oldPayment });
  if (current.stage === '待回款' && invoice === current.contract_amount && payment >= invoice) setStage(db, orderId, '已回款', actor, '回款完成');
  return state(db, orderId);
}

/**
 * User-facing finance input is an addition, not a replacement of the running total.
 * Convert it to the persisted cumulative totals here so the UI does not expose
 * an accounting/storage detail that users have to calculate themselves.
 */
export function recordFinanceIncrease(db: Database.Database, orderId: string, values: { invoice?: number; payment?: number }, actor: string) {
  const current = state(db, orderId);
  const invoiceIncrease = values.invoice ?? 0;
  const paymentIncrease = values.payment ?? 0;
  if (invoiceIncrease < 0 || paymentIncrease < 0) throw new Error('INVALID_MONEY');
  return recordFinance(db, orderId, {
    invoice: current.invoice + invoiceIncrease,
    payment: current.payment + paymentIncrease
  }, actor);
}

export function updateOrderStage(db: Database.Database, orderId: string, stage: string, actor: string) {
  return setStage(db, orderId, stage, actor, '更新订单阶段');
}

export function stateForAcceptanceIssue(db: Database.Database, issue: { order_id: string; status: string }) {
  const current = state(db, issue.order_id);
  if (!['执行中', '待复验'].includes(current.stage)) throw new Error('ACCEPTANCE_ISSUE_CLOSE_STAGE_REQUIRED');
  if (!['待整改', '已整改'].includes(issue.status)) throw new Error('ACCEPTANCE_ISSUE_NOT_OPEN');
  if (issue.status === '待整改' && current.stage === '待复验') throw new Error('ACCEPTANCE_ISSUE_MUST_BE_REPAIRED');
  return current;
}

export function updateExpenseStatus(db: Database.Database, expense: { id: string; order_id: string; status: string; proof: string; reject_reason: string | null }, next: string, proof: string, reason: string, actor: string) {
  const transitionsForStatus = { 待审核: ['待报销', '已驳回'], 待报销: ['已报销', '已驳回'], 已驳回: ['待审核'], 已报销: [] } as Record<string, string[]>;
  if (!transitionsForStatus[expense.status]?.includes(next)) throw new Error('INVALID_EXPENSE_TRANSITION');
  const rejectionReason = reason.trim();
  if (next === '已驳回' && !rejectionReason) throw new Error('EXPENSE_REJECTION_REASON_REQUIRED');
  if (expense.status === '已驳回' && next === '待审核' && (!proof.trim() || proof === '待上传凭证')) throw new Error('EXPENSE_PROOF_REQUIRED');
  const changedAt = isoNow();
  const reviewFields = next === '待报销' || next === '已驳回'
    ? { reviewed_by: actor, reviewed_at: changedAt }
    : { reimbursed_by: actor, reimbursed_at: changedAt };
  const rejectReason = next === '已驳回' ? rejectionReason : next === '待审核' ? null : expense.reject_reason;
  db.prepare('UPDATE expenses SET status=?,proof=?,updated_by=?,version=version+1,reviewed_by=COALESCE(?,reviewed_by),reviewed_at=COALESCE(?,reviewed_at),reject_reason=?,reimbursed_by=COALESCE(?,reimbursed_by),reimbursed_at=COALESCE(?,reimbursed_at) WHERE id=?').run(next, proof || expense.proof || '', actor, reviewFields.reviewed_by ?? null, reviewFields.reviewed_at ?? null, rejectReason, reviewFields.reimbursed_by ?? null, reviewFields.reimbursed_at ?? null, expense.id);
  if (next === '待报销' || next === '已报销') {
    const row = db.prepare('SELECT amount,occurred_on FROM expenses WHERE id=?').get(expense.id) as { amount: number; occurred_on: string };
    recordCost(db, { orderId: expense.order_id, sourceType: 'expense', sourceId: expense.id, costType: '实际', amount: row.amount, occurredOn: row.occurred_on, actor });
  } else if (next === '已驳回') {
    db.prepare("UPDATE cost_entries SET status='已冲销',created_by=?,created_at=? WHERE source_type='expense' AND source_id=? AND status='有效'").run(actor, changedAt, expense.id);
  }
  db.prepare('INSERT INTO status_history VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), expense.order_id, 'expense', expense.id, expense.status, next, '更新费用状态', actor, next === '已驳回' ? rejectionReason : null, changedAt);
  touch(db, expense.order_id);
  audit(db, expense.order_id, '更新费用状态', actor, { expense_id: expense.id, from: expense.status, to: next, ...(next === '已驳回' ? { reason: rejectionReason } : {}) });
}
