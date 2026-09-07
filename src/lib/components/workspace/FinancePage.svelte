<script lang="ts">
  import { getContext } from 'svelte';
  import Button from '$lib/components/Button.svelte';
  import { Wallet, ArrowRight } from 'lucide-svelte';
  import type { WorkspaceContext } from '$lib/workspace-context';
  import { WORKSPACE_CONTEXT } from '$lib/workspace-context';
  import { date, money } from '$lib/workspace-utils';

  const workspace = getContext<WorkspaceContext>(WORKSPACE_CONTEXT);
  const order = $derived(workspace.state.order!);
  const outstanding = $derived(Math.max(0, order.workflow.invoice - order.workflow.payment));
</script>

<section>
  <div class="page-head"><div><div class="eyebrow">FINANCE · CLOSE THE LOOP</div><h1>财务跟进</h1><p>项目验收并完成结算后，进入开票与回款跟进。开票不能超过合同额，回款不能超过已开票金额。</p></div><Button variant="primary" onclick={() => workspace.open('finance')}><Wallet size={16} />登记本次开票/回款</Button></div>
  <div class="finance-cards">
    <div class="finance-card"><small>合同额</small><strong>{money(order.contract_amount)}</strong><span>客户合同口径</span></div>
    <div class="finance-card"><small>预计成本</small><strong>{money(order.cost_summary.find((item) => item.cost_type === '预计')?.amount)}</strong><span>物料与采购计划</span></div>
    <div class="finance-card"><small>承诺成本</small><strong>{money(order.cost_summary.find((item) => item.cost_type === '承诺')?.amount)}</strong><span>采购定标承诺</span></div>
    <div class="finance-card"><small>实际成本</small><strong>{money(order.actual_cost)}</strong><span>已确认发生</span></div>
  </div>
  <section class="panel finance-status"><div class="panel-head"><div><div class="section-kicker">回款闭环</div><h2>开票与回款状态</h2></div><span class="status-pill" class:green={!outstanding} class:orange={Boolean(outstanding)}>{outstanding ? `待回款 ${money(outstanding)}` : '已完成回款'}</span></div>
    <div class="finance-status-grid"><div><small>结算状态</small><b>{order.workflow.settled ? '已结算' : '待结算'}</b><p>{order.stage === '已验收' ? '验收通过后可在工作台完成结算' : '项目完成验收后才能结算'}</p></div><div><small>开票进度</small><b>{money(order.workflow.invoice)} / {money(order.contract_amount)}</b><p>已开票金额不得超过合同额</p></div><div><small>回款进度</small><b>{money(order.workflow.payment)} / {money(order.workflow.invoice)}</b><p>{outstanding ? `还需回款 ${money(outstanding)}` : '回款已达到开票金额'}</p></div></div>
  </section>
  <section class="panel section-gap"><div class="panel-head"><div><div class="section-kicker">财务明细</div><h2>发票与回款明细</h2></div><span>{order.invoices.length + order.payments.length} 笔</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>类型</th><th>单号/流水号</th><th>日期</th><th>金额</th><th>状态</th></tr></thead><tbody>{#each order.invoices as invoice}<tr><td>发票</td><td>{invoice.invoice_no}</td><td>{date(invoice.issued_on || undefined)}</td><td><b>{money(invoice.amount)}</b></td><td>{invoice.status}</td></tr>{/each}{#each order.payments as payment}<tr><td>回款</td><td>{payment.reference_no || '—'}</td><td>{date(payment.paid_on)}</td><td><b>{money(payment.amount)}</b></td><td>已到账</td></tr>{/each}{#if !order.invoices.length && !order.payments.length}<tr><td colspan="5" class="guided-empty">暂无发票或回款记录。完成项目结算后，在上方登记本次开票和回款金额。</td></tr>{/if}</tbody></table></div></section>
</section>
