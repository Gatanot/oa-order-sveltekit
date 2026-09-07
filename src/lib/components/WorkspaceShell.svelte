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
  import { stageTone } from '$lib/workspace-utils';
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
    PAYMENT_INCOMPLETE: '回款未达到已开票金额，项目暂不能完结', INVOICE_INCOMPLETE: '合同金额尚未全部开票，项目暂不能完结',
    INVOICE_EXCEEDS_CONTRACT: '已开票金额不能超过合同金额', FINANCE_CLOSED: '项目已完成回款，不能继续登记财务数据',
    PAYMENT_EXCEEDS_INVOICE: '回款金额不能超过已开票金额', OVER_BUDGET_APPROVAL_REQUIRED: '该报价超过预算，需要审批确认',
    RESOLUTION_NOTE_REQUIRED: '请填写整改说明或复验备注', ACCEPTANCE_ISSUE_CLOSE_STAGE_REQUIRED: '当前阶段不能处理验收问题',
    INVALID_EXPENSE_TRANSITION: '当前费用状态不能执行此操作', FINANCE_TOTAL_CANNOT_DECREASE: '开票或回款累计金额不能减少',
    INVALID_ORDER_AMOUNTS: '请检查合同金额和预算成本，预算不能高于合同金额', CUSTOMER_REQUIRED: '请填写客户名称',
    NAME_REQUIRED: '请填写项目名称', ACCEPTANCE_VERIFY_STAGE_REQUIRED: '只有项目进入待复验后，才能确认验收问题通过',
    ACCEPTANCE_ISSUE_MUST_BE_REPAIRED: '验收问题还未完成整改，请先标记整改完成',
    QUOTE_CONFIRM_REQUIRED: '请先确认一个有效报价版本，再进入执行阶段',
    ACCEPTANCE_ALREADY_SUBMITTED: '当前项目已经提交复验，请等待验收结果',
    ACCEPTANCE_RETURN_NOT_ALLOWED: '当前项目不在待复验阶段，无法退回整改',
    ACCEPTANCE_NOT_PASSED: '请先完成验收，再进行项目结算',
    ALREADY_SETTLED: '项目已经完成结算',
    INVALID_MONEY: '金额必须是有效的非负数',
    ORDER_WORKFLOW_NOT_FOUND: '项目流程信息不存在，请刷新后重试',
    NO_WORKFLOW_COMMAND: '当前操作缺少必要信息，请刷新后重试', NO_FINANCE_CHANGE: '请至少填写一笔开票或回款金额',
    EXPENSE_REJECTION_REASON_REQUIRED: '请填写费用驳回原因'
  };

  // Modules are separate static routes, so the active view is read from the URL
  // rather than the old dynamic `view` route param.
  const currentView = $derived(((() => {
    const segment = page.url.pathname.split('/').filter(Boolean).at(-1);
    return segment && views.includes(segment as View) ? segment : 'dashboard';
  })()) as View);
  const modalTitles: Record<ModalKind, string> = {
    order: '新建项目', task: '新增项目工作项', expense: '录入项目费用', quote: '新增报价版本',
    material: '录入物料成本', procurement: '新增采购需求', offer: '新增供应商报价', issue: '登记验收问题', finance: '登记本次开票与回款',
    attachment: '关联费用凭证', 'reject-expense': '驳回费用'
  };
  const modalDescriptions: Record<ModalKind, string> = {
    order: '填写客户、项目和金额，创建项目。',
    task: '写下要跟进的一件事。',
    expense: '填写一笔项目费用，审核后计入实际成本。',
    quote: '填写客户确认过的报价信息。',
    material: '填写一项物料及其实际成本。',
    procurement: '填写要采购的物品和预算。',
    offer: '填写供应商对当前采购项目的报价。',
    issue: '填写需要整改的验收问题。',
    finance: '填写本次发生的开票和回款金额，没有发生就填 0。',
    attachment: '填写要关联到这笔费用的凭证名称。',
    'reject-expense': '填写驳回这笔费用的原因。'
  };
  let modalOpen = $state(false);
  let modalKind = $state<ModalKind>('order');
  let targetItem = $state<ProcurementItem | null>(null);
  let targetExpenseId = $state<string | null>(null);
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
    if (!window.confirm(`确认选择供应商“${offer.supplier}”，报价 ¥${(offer.amount / 100).toFixed(2)} 并回写项目承诺成本吗？`)) return;
    workspaceState.busy = true;
    try {
      try { await api.post(`/api/procurement-items/${item.id}/award`, { offer_id: offer.id }); }
      catch (reason) {
        const text = reason instanceof Error ? reason.message : '';
        if (!text.includes('OVER_BUDGET_APPROVAL_REQUIRED')) throw reason;
        if (!window.confirm(`报价 ¥${(offer.amount / 100).toFixed(2)} 超出预算，仍要定标吗？`)) return;
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

  function openAction(kind: 'attachment' | 'reject-expense', expenseId: string) {
    targetExpenseId = expenseId;
    modalKind = kind;
    form = kind === 'attachment' ? { name: '' } : { reason: '请补充合规凭证' };
    modalOpen = true;
  }

  async function attachProof(expenseId: string) {
    openAction('attachment', expenseId);
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
    openAction('reject-expense', expense.id);
  }

  function open(kind: ModalKind, item: ProcurementItem | null = null) {
    modalKind = kind; targetItem = item;
    const today = new Date().toISOString().slice(0, 10);
    const order = workspaceState.order;
    const defaults: Record<ModalKind, Record<string, string | number>> = {
      order: { customer: '', name: '', owner: '', contract_amount: '', budget_cost: '' }, task: { title: '' },
      expense: { category: '', occurred_on: today, amount: '', payment_type: '员工垫付', payer: '', proof: '' },
      quote: { version: `V${(order?.quotes.length ?? 0) + 1}`, total: '', estimated_cost: '', proof: '' },
      material: { name: '', quantity: 1, unit: '项', cost_unit: '', supplier: '' },
      procurement: { name: '', budget: '' }, offer: { supplier: '', amount: '', proof: '供应商报价单' },
      issue: { description: '', owner: '', due_date: '' }, finance: { invoice_addition: 0, payment_addition: 0 },
      attachment: { name: '' }, 'reject-expense': { reason: '请补充合规凭证' }
    };
    form = defaults[kind]; modalOpen = true;
  }

  async function submitModal() {
    const code = workspaceState.order?.code;
    if (modalKind !== 'order' && !code) return;
    if (modalKind === 'attachment') {
      await run(async () => {
        await api.post(`/api/orders/${code}/attachments`, { name: String(form.name || '').trim(), kind: '费用凭证', related_type: 'expense', related_id: targetExpenseId });
        modalOpen = false;
        await reload();
      }, '凭证已关联费用单');
      return;
    }
    if (modalKind === 'reject-expense') {
      await run(async () => {
        await api.post(`/api/expenses/${targetExpenseId}/status`, { status: '已驳回', reason: String(form.reason || '').trim() });
        modalOpen = false;
        await reload();
      }, '费用已驳回，已记录原因');
      return;
    }
    const paths: Record<Exclude<ModalKind, 'order'>, string> = {
      task: `/api/orders/${code}/tasks`, expense: `/api/orders/${code}/expenses`, quote: `/api/orders/${code}/quotes`,
      material: `/api/orders/${code}/materials`, procurement: `/api/orders/${code}/procurement-items`,
      offer: `/api/procurement-items/${targetItem?.id}/offers`, issue: `/api/orders/${code}/acceptance-issues`, finance: `/api/orders/${code}/workflow`,
      attachment: `/api/orders/${code}/attachments`, 'reject-expense': `/api/expenses/${targetExpenseId}/status`
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
        <a class:active={currentView === key} href={`/workspace/${encodeURIComponent(workspaceState.order!.code)}/${key}`} aria-label={label} title={label} aria-current={currentView === key ? 'page' : undefined}>
          <Icon size={17} /><span>{label}</span>{#if currentView === key}<ChevronRight class="nav-arrow" size={14} />{/if}
        </a>
      {/each}
    </nav>
    <div class="sidebar-bottom"><div class="mini-user"><div class="avatar">演</div><div><b>演示账号</b><small>登录用户功能待接入</small></div></div></div>
  </aside>

  <main class="main">
    <header class="topbar">
      <div class="top-context">
        <div class="breadcrumb">工作空间 <span>/</span> <b>{nav.find(([key]) => key === currentView)?.[1]}</b></div>
        {#if workspaceState.order}<label class="project-switcher"><span>当前项目</span><select aria-label="切换当前项目" value={workspaceState.order.code} onchange={(event) => choose((event.currentTarget as HTMLSelectElement).value)}>{#each workspaceState.orders as item}<option value={item.code}>{item.code} · {item.name}</option>{/each}</select><strong class={`status-pill ${stageTone(workspaceState.order.stage)}`}>{workspaceState.order.stage}</strong><small class="project-owner">负责人：{workspaceState.order.owner || '未分配'}</small></label>{/if}
      </div>
      <div class="top-actions">
        <button class="icon-btn" title="刷新数据" aria-label="刷新数据" disabled={workspaceState.busy} onclick={() => run(() => reload(), '数据已刷新')}><RefreshCw size={17} /></button>
        <Button size="sm" onclick={() => { if (workspaceState.order) window.location.href = `/api/orders/${workspaceState.order.code}/export`; }}>导出</Button>
        <Button size="sm" variant="danger" onclick={resetDemo}>重置</Button>
        <Button size="sm" variant="primary" onclick={() => open('order')}><Plus size={16} />新建项目</Button>
      </div>
    </header>
    {#if workspaceState.errorMessage}<div class="notice error" role="alert">{workspaceState.errorMessage}</div>{/if}
    {#if workspaceState.order}<div class="workflow-strip" aria-label="项目流程"><div class="workflow-strip-title"><b>{workspaceState.order.name}</b><small>{workspaceState.order.code} · {workspaceState.order.customer}</small></div><div class="workflow-strip-stages">{#each ['报价中', '执行中', '待复验', '已验收', '待回款', '已回款'] as stage, index}<span class:current={stage === workspaceState.order.stage} class:done={['报价中', '执行中', '待复验', '已验收', '待回款', '已回款'].indexOf(workspaceState.order.stage) > index}>{index + 1}. {stage}</span>{/each}</div></div>{/if}
    <div class="content">{@render children()}</div>
  </main>
</div>

<Modal bind:open={modalOpen} title={modalTitles[modalKind]} description={modalDescriptions[modalKind]} busy={workspaceState.busy} onsubmit={submitModal} submitLabel={modalKind === 'finance' ? '登记' : modalKind === 'attachment' ? '关联' : modalKind === 'reject-expense' ? '驳回' : '保存'}>
  {#if modalKind === 'order'}
    <label class="form-field">客户名称<span class="required-mark">必填</span><input bind:value={form.customer} placeholder="例如：华东科技有限公司" required /></label>
    <label class="form-field">项目名称<span class="required-mark">必填</span><input bind:value={form.name} placeholder="例如：办公楼弱电改造项目" required /></label>
    <label class="form-field">项目负责人<span class="optional-mark">选填</span><input bind:value={form.owner} placeholder="例如：张三" /></label>
    <label class="form-field">合同金额（元）<span class="required-mark">必填</span><input bind:value={form.contract_amount} type="number" min="0.01" step="0.01" placeholder="0.00" required /></label>
    <label class="form-field">预算成本（元）<span class="required-mark">必填</span><input bind:value={form.budget_cost} type="number" min="0.01" step="0.01" placeholder="0.00" required /></label>
  {:else if modalKind === 'task'}
    <label class="form-field">工作内容<span class="required-mark">必填</span><input bind:value={form.title} placeholder="例如：整理客户验收资料" required /></label>
  {:else if modalKind === 'expense'}
    <label class="form-field">费用项目<span class="required-mark">必填</span><input bind:value={form.category} placeholder="例如：差旅费、材料费、招待费" required /></label>
    <label class="form-field">发生日期<span class="optional-mark">选填</span><input bind:value={form.occurred_on} type="date" /></label>
    <label class="form-field">费用金额（元）<span class="required-mark">必填</span><input bind:value={form.amount} type="number" min="0.01" step="0.01" placeholder="0.00" required /></label>
    <label class="form-field">付款人或付款主体<span class="optional-mark">选填</span><input bind:value={form.payer} placeholder="例如：李四 / 公司账户" /></label>
    <label class="form-field">凭证说明<span class="optional-mark">选填</span><input bind:value={form.proof} placeholder="例如：发票号、付款截图名称" /></label>
  {:else if modalKind === 'quote'}
    <label class="form-field">报价版本号<span class="required-mark">必填</span><input bind:value={form.version} placeholder="例如：V1" required /></label>
    <label class="form-field">报价总额（元）<span class="required-mark">必填</span><input bind:value={form.total} type="number" min="0.01" step="0.01" placeholder="0.00" required /></label>
    <label class="form-field">预计成本（元）<span class="required-mark">必填</span><input bind:value={form.estimated_cost} type="number" min="0" step="0.01" placeholder="0.00" required /></label>
    <label class="form-field">客户确认凭证<span class="required-mark">必填</span><input bind:value={form.proof} placeholder="例如：客户确认邮件 2026-03-20" required /></label>
  {:else if modalKind === 'material'}
    <label class="form-field">物料名称<span class="required-mark">必填</span><input bind:value={form.name} placeholder="例如：六类网线" required /></label>
    <label class="form-field">数量<span class="required-mark">必填</span><input bind:value={form.quantity} type="number" min="0.01" step="0.01" placeholder="例如：10" required /></label>
    <label class="form-field">计量单位<span class="required-mark">必填</span><input bind:value={form.unit} placeholder="例如：箱、件、米" required /></label>
    <label class="form-field">成本单价（元）<span class="required-mark">必填</span><input bind:value={form.cost_unit} type="number" min="0" step="0.01" placeholder="0.00" required /></label>
    <label class="form-field">供应商<span class="optional-mark">选填</span><input bind:value={form.supplier} placeholder="例如：某某建材有限公司" /></label>
  {:else if modalKind === 'procurement'}
    <label class="form-field">采购项目<span class="required-mark">必填</span><input bind:value={form.name} placeholder="例如：机房服务器" required /></label>
    <label class="form-field">采购预算（元）<span class="required-mark">必填</span><input bind:value={form.budget} type="number" min="0.01" step="0.01" placeholder="0.00" required /></label>
  {:else if modalKind === 'offer'}
    <label class="form-field">供应商名称<span class="required-mark">必填</span><input bind:value={form.supplier} placeholder="例如：某某设备有限公司" required /></label>
    <label class="form-field">供应商报价（元）<span class="required-mark">必填</span><input bind:value={form.amount} type="number" min="0.01" step="0.01" placeholder="0.00" required /></label>
    <label class="form-field">报价凭证<span class="required-mark">必填</span><input bind:value={form.proof} placeholder="例如：供应商报价单 2026-03-20" required /></label>
  {:else if modalKind === 'issue'}
    <label class="form-field">验收问题描述<span class="required-mark">必填</span><textarea bind:value={form.description} placeholder="请描述问题现象、位置和影响" required></textarea></label>
    <label class="form-field">整改负责人<span class="optional-mark">选填</span><input bind:value={form.owner} placeholder="例如：张三" /></label>
    <label class="form-field">整改截止日期<span class="optional-mark">选填</span><input bind:value={form.due_date} type="date" /></label>
  {:else if modalKind === 'finance'}
    <label class="form-field finance-field">本次开票金额（元）<span class="optional-mark">无新增填 0</span><input bind:value={form.invoice_addition} type="number" min="0" step="0.01" placeholder="0.00" required /></label>
    <label class="form-field finance-field">本次回款金额（元）<span class="optional-mark">无新增填 0</span><input bind:value={form.payment_addition} type="number" min="0" step="0.01" placeholder="0.00" required /></label>
  {:else if modalKind === 'attachment'}
    <label class="form-field">凭证名称<span class="required-mark">必填</span><input bind:value={form.name} placeholder="例如：差旅费发票.jpg" required /></label>
  {:else}
    <label class="form-field">驳回原因<span class="required-mark">必填</span><textarea bind:value={form.reason} placeholder="请写明需要补充或修改的内容" required></textarea></label>
  {/if}
</Modal>

{#if workspaceState.message}<div class="toast on" role="status">{workspaceState.message}</div>{/if}
