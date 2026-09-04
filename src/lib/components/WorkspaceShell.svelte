<script lang="ts">
  import { setContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { Activity, ChevronRight, FolderKanban, LayoutDashboard, Plus, RefreshCw, ClipboardCheck, FileText, ShoppingCart, Wallet, ReceiptText } from 'lucide-svelte';
  import Button from '$lib/components/Button.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import { api } from '$lib/api';
  import type { ProcurementItem, WorkspaceData } from '$lib/types';
  import { WORKSPACE_CONTEXT, type ModalKind, type View, type WorkspaceContext, type WorkspaceState, views } from '$lib/workspace-context';

  let { data, children }: { data: WorkspaceData; children: import('svelte').Snippet } = $props();
  let workspaceState: WorkspaceState = $state({
    orders: data.orders,
    order: data.order,
    busy: false,
    message: '',
    errorMessage: ''
  });

  const nav = [
    ['dashboard', '经营工作台', LayoutDashboard], ['orders', '订单台账', FolderKanban],
    ['quotes', '报价与确认', FileText], ['procure', '采购与成本', ShoppingCart],
    ['accept', '验收与整改', ClipboardCheck], ['finance', '财务跟进', Wallet], ['expenses', '项目费用与报销', ReceiptText]
  ] as const;
  const errorCopy: Record<string, string> = {
    QUOTE_CONFIRM_STAGE_REQUIRED: '当前订单已进入执行阶段，不能再确认报价版本',
    QUOTE_PROOF_REQUIRED: '请先补充客户确认凭证', OPEN_ACCEPTANCE_ISSUES: '还有未完成的验收整改，请先处理后再提交复验',
    ACCEPTANCE_SUBMISSION_REQUIRED: '请先提交复验，才能执行此动作', ACCEPTANCE_SUBMIT_STAGE_REQUIRED: '只有执行中的项目可以提交复验',
    INVALID_STAGE_TRANSITION: '当前阶段不能执行此操作，请按流程推进', SETTLEMENT_REQUIRED: '请先完成项目结算',
    PAYMENT_INCOMPLETE: '回款未达到已开票金额，项目暂不能完结', INVOICE_EXCEEDS_CONTRACT: '已开票金额不能超过合同金额',
    PAYMENT_EXCEEDS_INVOICE: '回款金额不能超过已开票金额', OVER_BUDGET_APPROVAL_REQUIRED: '该报价超过预算，需要审批确认',
    RESOLUTION_NOTE_REQUIRED: '请填写整改说明或复验备注', ACCEPTANCE_ISSUE_CLOSE_STAGE_REQUIRED: '当前阶段不能处理验收问题',
    INVALID_EXPENSE_TRANSITION: '当前费用状态不能执行此操作', FINANCE_TOTAL_CANNOT_DECREASE: '开票或回款累计金额不能减少',
    INVALID_ORDER_AMOUNTS: '请检查合同金额和预算成本，预算不能高于合同金额', CUSTOMER_REQUIRED: '请填写客户名称',
    NAME_REQUIRED: '请填写项目名称', ACCEPTANCE_VERIFY_STAGE_REQUIRED: '只有项目进入待复验后，才能确认验收问题通过',
    ACCEPTANCE_ISSUE_MUST_BE_REPAIRED: '验收问题还未完成整改，请先标记整改完成'
  };

  const currentView = $derived((page.params.view && views.includes(page.params.view as View) ? page.params.view : 'dashboard') as View);
  const modalTitles: Record<ModalKind, string> = {
    order: '新建项目', task: '新增项目工作项', expense: '录入项目费用', quote: '新增报价版本',
    material: '录入物料成本', procurement: '新增采购需求', offer: '新增供应商报价', issue: '登记验收问题', finance: '更新开票与回款'
  };
  let modalOpen = $state(false);
  let modalKind = $state<ModalKind>('order');
  let targetItem = $state<ProcurementItem | null>(null);
  let form = $state<Record<string, string | number>>({});

  // A project change re-runs the [order] layout load. Keep the shell state in sync
  // while preserving the same shell instance during client-side navigation.
  $effect(() => {
    workspaceState.orders = data.orders;
    workspaceState.order = data.order;
  });

  function notify(text: string, isError = false) {
    const display = errorCopy[text] || text;
    if (isError) workspaceState.errorMessage = display; else workspaceState.message = display;
    window.setTimeout(() => { workspaceState.message = ''; workspaceState.errorMessage = ''; }, 3500);
  }

  async function run(action: () => Promise<void>, success: string) {
    workspaceState.busy = true;
    try { await action(); notify(success); }
    catch (reason) { notify(reason instanceof Error ? reason.message : '操作未完成', true); }
    finally { workspaceState.busy = false; }
  }

  async function reload(code = workspaceState.order?.code) {
    const list = await api.get<{ data: WorkspaceData['orders'] }>('/api/orders');
    workspaceState.orders = list.data;
    const selected = code ?? list.data[0]?.code;
    workspaceState.order = selected ? (await api.get<{ data: NonNullable<WorkspaceData['order']> }>(`/api/orders/${encodeURIComponent(selected)}`)).data : null;
  }

  async function mutate(path: string, body: Record<string, unknown>, success: string) {
    await run(async () => { await api.post(path, body); await reload(); }, success);
  }

  async function award(item: ProcurementItem, offer: { id: string; supplier: string; amount: number }) {
    workspaceState.busy = true;
    try {
      if (!window.confirm(`确认选择供应商“${offer.supplier}”，报价 ¥${(offer.amount / 100).toFixed(2)} 并回写项目承诺成本吗？`)) return;
      try { await api.post(`/api/procurement-items/${item.id}/award`, { offer_id: offer.id }); }
      catch (reason) {
        const text = reason instanceof Error ? reason.message : '';
        if (!text.includes('OVER_BUDGET_APPROVAL_REQUIRED')) throw reason;
        if (!window.confirm(`供应商报价已超过预算，确认进入审批模拟并定标吗？`)) return;
        await api.post(`/api/procurement-items/${item.id}/award`, { offer_id: offer.id, approved: true });
      }
      await reload(); notify('采购已定标，成本已回写');
    } catch (reason) { notify(reason instanceof Error ? reason.message : '采购定标失败', true); }
    finally { workspaceState.busy = false; }
  }

  async function resetDemo() {
    if (!workspaceState.order || !window.confirm('恢复当前订单的演示流程状态？已录入的业务明细会保留。')) return;
    await mutate(`/api/orders/${workspaceState.order.code}/reset`, {}, '演示流程已重置');
  }

  async function attachProof(expenseId: string) {
    if (!workspaceState.order) return;
    const name = window.prompt('凭证文件名（演示只保存文件信息，不上传二进制）', '发票或付款截图.png');
    if (!name?.trim()) return;
    await run(async () => {
      await api.post(`/api/orders/${workspaceState.order!.code}/attachments`, { name: name.trim(), kind: '费用凭证', related_type: 'expense', related_id: expenseId });
      await reload();
    }, '凭证已关联费用单');
  }

  async function selectView(next: View) {
    if (!workspaceState.order) return;
    await goto(`/workspace/${encodeURIComponent(workspaceState.order.code)}/${next}`, { keepFocus: true, noScroll: true });
  }

  async function choose(code: string) {
    await goto(`/workspace/${encodeURIComponent(code)}/dashboard`, { keepFocus: true, noScroll: true });
  }

  async function toggleTask(task: { id: string; done: number }) {
    await run(async () => { await api.post(`/api/tasks/${task.id}/toggle`, { done: !task.done }); await reload(); }, task.done ? '任务已重新打开' : '任务已完成');
  }

  async function rejectExpense(expense: { id: string }) {
    const reason = window.prompt('请输入驳回原因', '请补充合规凭证');
    if (!reason?.trim()) return;
    await mutate(`/api/expenses/${expense.id}/status`, { status: '已驳回', proof: reason.trim() }, '费用已驳回，已记录原因');
  }

  function open(kind: ModalKind, item: ProcurementItem | null = null) {
    modalKind = kind; targetItem = item;
    const today = new Date().toISOString().slice(0, 10);
    const order = workspaceState.order;
    const defaults: Record<ModalKind, Record<string, string | number>> = {
      order: { customer: '', name: '', owner: '', contract_amount: 0, budget_cost: 0 }, task: { title: '' },
      expense: { category: '', occurred_on: today, amount: 0, payment_type: '员工垫付', payer: '', proof: '' },
      quote: { version: `V${(order?.quotes.length ?? 0) + 1}`, total: (order?.contract_amount ?? 0) / 100, estimated_cost: (order?.budget_cost ?? 0) / 100, proof: '客户确认邮件' },
      material: { name: '', quantity: 1, unit: '项', cost_unit: 0, supplier: '' },
      procurement: { name: '', budget: 0 }, offer: { supplier: '', amount: (item?.budget ?? 0) / 100, proof: '供应商报价单' },
      issue: { description: '', owner: '', due_date: '' }, finance: { invoice: (order?.workflow.invoice ?? 0) / 100, payment: (order?.workflow.payment ?? 0) / 100 }
    };
    form = defaults[kind]; modalOpen = true;
  }

  async function submitModal() {
    const code = workspaceState.order?.code;
    if (modalKind !== 'order' && !code) return;
    const paths: Record<Exclude<ModalKind, 'order'>, string> = {
      task: `/api/orders/${code}/tasks`, expense: `/api/orders/${code}/expenses`, quote: `/api/orders/${code}/quotes`,
      material: `/api/orders/${code}/materials`, procurement: `/api/orders/${code}/procurement-items`,
      offer: `/api/procurement-items/${targetItem?.id}/offers`, issue: `/api/orders/${code}/acceptance-issues`, finance: `/api/orders/${code}/workflow`
    };
    await run(async () => {
      const result = await api.post<{ data?: { code?: string } }>(modalKind === 'order' ? '/api/orders' : paths[modalKind], form);
      modalOpen = false;
      await reload(modalKind === 'order' ? result.data?.code : code);
      if (modalKind === 'order' && result.data?.code) await goto(`/workspace/${encodeURIComponent(result.data.code)}/quotes`);
    }, '操作已保存');
  }

  const context: WorkspaceContext = { state: workspaceState, data, selectView, choose, reload, mutate, award, attachProof, toggleTask, rejectExpense, resetDemo, open };
  setContext(WORKSPACE_CONTEXT, context);
</script>

<svelte:head><title>ORBIT OA · 项目经营闭环</title><meta name="description" content="订单、采购、验收与财务一体化项目工作台" /></svelte:head>

<div class="app-shell">
  <aside class="sidebar">
    <div class="brand-mark"><span>O</span><div><b>ORBIT OA</b><small>项目经营闭环</small></div></div>
    <div class="workspace-label">我的工作空间</div>
    <nav class="nav" aria-label="主导航">
      {#each nav as [key, label, Icon]}
        <a class:active={currentView === key} href={`/workspace/${encodeURIComponent(workspaceState.order!.code)}/${key}`} aria-current={currentView === key ? 'page' : undefined}>
          <Icon size={17} /><span>{label}</span>{#if currentView === key}<ChevronRight class="nav-arrow" size={14} />{/if}
        </a>
      {/each}
    </nav>
    <div class="sidebar-bottom"><div class="mini-user"><div class="avatar">李</div><div><b>李海明</b><small>项目负责人</small></div><span class="online"></span></div></div>
  </aside>

  <main class="main">
    <header class="topbar">
      <div class="breadcrumb">工作空间 <span>/</span> <b>{nav.find(([key]) => key === currentView)?.[1]}</b></div>
      <div class="top-actions">
        <button class="icon-btn" title="刷新数据" aria-label="刷新数据" disabled={workspaceState.busy} onclick={() => run(() => reload(), '数据已刷新')}><RefreshCw size={17} /></button>
        <Button size="sm" onclick={() => { if (workspaceState.order) window.location.href = `/api/orders/${workspaceState.order.code}/export`; }}>导出</Button>
        <Button size="sm" variant="danger" onclick={resetDemo}>重置</Button>
        <Button size="sm" variant="primary" onclick={() => open('order')}><Plus size={16} />新建项目</Button>
      </div>
    </header>
    {#if workspaceState.errorMessage}<div class="notice error" role="alert">{workspaceState.errorMessage}</div>{/if}
    <div class="content">{@render children()}</div>
  </main>
</div>

<Modal bind:open={modalOpen} title={modalTitles[modalKind]} busy={workspaceState.busy} onsubmit={submitModal} submitLabel="保存">
  {#if modalKind === 'order'}
    <label>客户名称<input bind:value={form.customer} required /></label><label>项目名称<input bind:value={form.name} required /></label><label>负责人<input bind:value={form.owner} /></label><label>合同金额<input bind:value={form.contract_amount} type="number" min="0.01" step="0.01" required /></label><label>预算成本<input bind:value={form.budget_cost} type="number" min="0.01" step="0.01" required /></label>
  {:else if modalKind === 'task'}<label>工作内容<input bind:value={form.title} required /></label>
  {:else if modalKind === 'expense'}<label>费用项目<input bind:value={form.category} required /></label><label>发生日期<input bind:value={form.occurred_on} type="date" /></label><label>金额<input bind:value={form.amount} type="number" min="0.01" step="0.01" required /></label><label>付款主体<input bind:value={form.payer} /></label><label>凭证说明<input bind:value={form.proof} /></label>
  {:else if modalKind === 'quote'}<label>版本号<input bind:value={form.version} required /></label><label>报价总额<input bind:value={form.total} type="number" min="0.01" step="0.01" required /></label><label>预计成本<input bind:value={form.estimated_cost} type="number" min="0" step="0.01" required /></label><label>确认凭证<input bind:value={form.proof} required /></label>
  {:else if modalKind === 'material'}<label>物料名称<input bind:value={form.name} required /></label><label>数量<input bind:value={form.quantity} type="number" min="0.01" step="0.01" required /></label><label>单位<input bind:value={form.unit} required /></label><label>成本单价<input bind:value={form.cost_unit} type="number" min="0" step="0.01" required /></label><label>供应商<input bind:value={form.supplier} /></label>
  {:else if modalKind === 'procurement'}<label>采购项目<input bind:value={form.name} required /></label><label>预算金额<input bind:value={form.budget} type="number" min="0.01" step="0.01" required /></label>
  {:else if modalKind === 'offer'}<label>供应商名称<input bind:value={form.supplier} required /></label><label>报价金额<input bind:value={form.amount} type="number" min="0.01" step="0.01" required /></label><label>报价凭证<input bind:value={form.proof} required /></label>
  {:else if modalKind === 'issue'}<label>问题描述<textarea bind:value={form.description} required></textarea></label><label>整改负责人<input bind:value={form.owner} /></label><label>截止日期<input bind:value={form.due_date} type="date" /></label>
  {:else}<p class="form-hint">当前累计：已开票 ¥{((workspaceState.order?.workflow.invoice ?? 0) / 100).toFixed(2)}，已回款 ¥{((workspaceState.order?.workflow.payment ?? 0) / 100).toFixed(2)}。请输入更新后的累计金额，系统会自动记录本次新增明细。</p><label>更新后已开票累计金额<input bind:value={form.invoice} type="number" min="0" step="0.01" required /></label><label>更新后已回款累计金额<input bind:value={form.payment} type="number" min="0" step="0.01" required /></label>{/if}
</Modal>

{#if workspaceState.message}<div class="toast" role="status">{workspaceState.message}</div>{/if}
