<script lang="ts">
  import { getContext } from 'svelte';
  import { Paperclip, Plus } from 'lucide-svelte';
  import Button from '$lib/components/Button.svelte';
  import type { WorkspaceContext } from '$lib/workspace-context';
  import { WORKSPACE_CONTEXT } from '$lib/workspace-context';
  import { date, money } from '$lib/workspace-utils';

  const workspace = getContext<WorkspaceContext>(WORKSPACE_CONTEXT);

  function hasProof(proof: string | null | undefined) {
    return Boolean(proof?.trim() && proof !== '待上传凭证');
  }
</script>

<section>
  <div class="page-head">
    <div>
      <div class="eyebrow">PROJECT COST · EXPENSES & REIMBURSEMENT</div>
      <h1>项目费用与报销</h1>
      <p>一个订单可以挂多张报价表、费用单和凭证，人员垫付与供应商采购分开记录。</p>
    </div>
    <div class="hero-actions">
      <Button onclick={() => workspace.open('expense')}><Plus size={16} />录入费用</Button>
    </div>
  </div>

  <div class="finance-cards">
    <div class="finance-card"><small>合同额</small><strong>{money(workspace.state.order!.contract_amount)}</strong><span>客户合同口径</span></div>
    <div class="finance-card"><small>预计成本</small><strong>{money(workspace.state.order!.cost_summary.find((item) => item.cost_type === '预计')?.amount)}</strong><span>物料与采购计划</span></div>
    <div class="finance-card"><small>承诺成本</small><strong>{money(workspace.state.order!.cost_summary.find((item) => item.cost_type === '承诺')?.amount)}</strong><span>采购定标承诺</span></div>
    <div class="finance-card"><small>实际成本</small><strong>{money(workspace.state.order!.actual_cost)}</strong><span>已确认发生</span></div>
  </div>

  <section class="panel">
    <div class="panel-head">
      <div><div class="section-kicker">费用审核队列</div><h2>项目费用与报销</h2></div>
      <span>{workspace.state.order!.expenses.length} 笔</span>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>费用项目</th><th>发生日期</th><th>金额</th><th>付款主体</th><th>凭证</th><th>状态</th><th>动作</th></tr></thead>
        <tbody>
          {#each workspace.state.order!.expenses as expense}
            <tr>
              <td><b>{expense.category}</b><small>{expense.payment_type}</small></td>
              <td>{date(expense.occurred_on)}</td>
              <td><b>{money(expense.amount)}</b></td>
              <td>{expense.payer || '未填写'}</td>
              <td><span class="attachment"><Paperclip size={13} />{expense.proof || '待上传'}</span><Button size="sm" onclick={() => workspace.attachProof(expense.id)}>上传凭证</Button></td>
              <td><span class="status-pill" class:green={expense.status === '已报销'} class:orange={expense.status !== '已报销'}>{expense.status}</span></td>
              <td>
                {#if expense.status === '待审核'}
                  <div class="action-group">
                    <Button size="sm" onclick={() => workspace.mutate(`/api/expenses/${expense.id}/status`, { status: '待报销', proof: expense.proof }, '审核已通过')}>审核通过</Button>
                    <Button size="sm" variant="danger" onclick={() => workspace.rejectExpense(expense)}>驳回</Button>
                  </div>
                {:else if expense.status === '已驳回'}
                  <div class="action-group">
                    <span class="muted">已驳回：{expense.reject_reason || '待补充'}</span>
                    <Button size="sm" disabled={!hasProof(expense.proof)} onclick={() => workspace.mutate(`/api/expenses/${expense.id}/status`, { status: '待审核', proof: expense.proof }, '已重新提交审核')}>重新提交审核</Button>
                  </div>
                {:else if expense.status === '待报销'}
                  <Button size="sm" onclick={() => workspace.mutate(`/api/expenses/${expense.id}/status`, { status: '已报销', proof: expense.proof }, '报销已完成')}>完成报销</Button>
                {:else}
                  <span class="muted">已归档</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</section>
