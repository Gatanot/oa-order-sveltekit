<script lang="ts">
  import {
    Activity, ArrowRight, BriefcaseBusiness, CheckCircle2, ChevronRight, Circle,
    ClipboardCheck, FileText, FolderKanban, LayoutDashboard, ListTodo, MessageCircle,
    PackageCheck, Paperclip, Plus, ReceiptText, RefreshCw, ShoppingCart, TriangleAlert,
    Wallet
  } from 'lucide-svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Button from '$lib/components/Button.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import { api } from '$lib/api';
  import type { OrderDetail, OrderSummary, ProcurementItem } from '$lib/types';
  import type { WorkspaceData } from '$lib/types';

  let { data }: { data: WorkspaceData } = $props();
  let orders = $state<OrderSummary[]>(data.orders);
  let order = $state<OrderDetail | null>(data.order);
  type View = 'dashboard' | 'orders' | 'quotes' | 'procure' | 'accept' | 'finance' | 'expenses';
  const validViews: View[] = ['dashboard', 'orders', 'quotes', 'procure', 'accept', 'finance', 'expenses'];
  const initialView = validViews.includes(data.view as View) ? data.view as View : 'dashboard';
  let view = $state<View>(initialView);
  $effect(() => {
    const next = page.url.searchParams.get('view');
    if (next && validViews.includes(next as View) && next !== view) view = next as View;
  });
  let busy = $state(false);
  let message = $state('');
  let errorMessage = $state('');
  let modalOpen = $state(false);
  let modalKind = $state<'order' | 'task' | 'expense' | 'quote' | 'material' | 'procurement' | 'offer' | 'issue' | 'finance'>('order');
  let targetItem = $state<ProcurementItem | null>(null);
  let form = $state<Record<string, string | number>>({});
  let orderSearch = $state('');
  let stageFilter = $state('全部');

  const pendingTasks = $derived(order?.tasks.filter((item) => !item.done).length ?? 0);
  const pendingExpenses = $derived(order?.expenses.filter((item) => item.status === '待审核').length ?? 0);
  const openIssues = $derived(order?.acceptance_issues.filter((item) => item.status === '待整改').length ?? 0);
  const pendingProcurement = $derived(order?.procurement_items.filter((item) => item.status !== '已定标').length ?? 0);
  const nextAction = $derived(order?.stage === '报价中' ? '创建并确认客户报价' : order?.stage === '执行中' ? (openIssues ? `完成 ${openIssues} 项验收整改` : pendingProcurement ? `完成 ${pendingProcurement} 项采购定标` : '准备并提交复验') : order?.stage === '待复验' ? '等待复验通过或退回整改' : order?.stage === '已验收' ? '完成项目结算' : order?.stage === '待回款' ? '登记回款，完成项目闭环' : '项目已完成');
  const stages = ['报价中', '执行中', '待复验', '已验收', '待回款', '已回款'];
  const margin = $derived((order?.contract_amount ?? 0) - (order?.actual_cost ?? 0));
  const modalTitles = {
    order: '新建项目', task: '新增项目工作项', expense: '录入项目费用', quote: '新增报价版本',
    material: '录入物料成本', procurement: '新增采购需求', offer: '新增供应商报价',
    issue: '登记验收问题', finance: '更新开票与回款'
  };
  const filteredOrders = $derived(orders.filter((item) => {
    const keyword = orderSearch.trim().toLowerCase();
    const matchesSearch = !keyword || `${item.code} ${item.name} ${item.customer} ${item.owner}`.toLowerCase().includes(keyword);
    return matchesSearch && (stageFilter === '全部' || item.stage === stageFilter);
  }));
  const nav = [
    ['dashboard', '经营工作台', LayoutDashboard], ['orders', '订单台账', FolderKanban],
    ['quotes', '报价与确认', FileText], ['procure', '采购与成本', ShoppingCart],
    ['accept', '验收与整改', ClipboardCheck], ['finance', '财务跟进', Wallet], ['expenses', '项目费用与报销', ReceiptText]
  ] as const;

  function money(value: number | undefined) {
    return `¥${(Number(value ?? 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  function date(value: string | undefined) { return value ? value.slice(0, 10) : '—'; }
  function stageProgress(stage = '') { return ({ 报价中: 20, 执行中: 48, 待复验: 68, 已验收: 82, 待回款: 92, 已回款: 100 }[stage] ?? 10); }
  function stageTone(stage: string) { return ['已验收', '待回款', '已回款'].includes(stage) ? 'green' : stage === '执行中' ? 'blue' : 'orange'; }
  function overdue(value: string | undefined) { return Boolean(value && value < new Date().toISOString().slice(0, 10)); }
  const errorCopy: Record<string, string> = {
    QUOTE_CONFIRM_STAGE_REQUIRED: '当前订单已进入执行阶段，不能再确认报价版本',
    QUOTE_PROOF_REQUIRED: '请先补充客户确认凭证',
    OPEN_ACCEPTANCE_ISSUES: '还有未完成的验收整改，请先处理后再提交复验',
    ACCEPTANCE_SUBMISSION_REQUIRED: '请先提交复验，才能执行此动作',
    ACCEPTANCE_SUBMIT_STAGE_REQUIRED: '只有执行中的项目可以提交复验',
    INVALID_STAGE_TRANSITION: '当前阶段不能执行此操作，请按流程推进',
    SETTLEMENT_REQUIRED: '请先完成项目结算',
    PAYMENT_INCOMPLETE: '回款未达到已开票金额，项目暂不能完结',
    INVOICE_EXCEEDS_CONTRACT: '已开票金额不能超过合同金额',
    PAYMENT_EXCEEDS_INVOICE: '回款金额不能超过已开票金额',
    OVER_BUDGET_APPROVAL_REQUIRED: '该报价超过预算，需要审批确认',
    RESOLUTION_NOTE_REQUIRED: '请填写整改说明或复验备注',
    ACCEPTANCE_ISSUE_CLOSE_STAGE_REQUIRED: '当前阶段不能处理验收问题',
    INVALID_EXPENSE_TRANSITION: '当前费用状态不能执行此操作',
    FINANCE_TOTAL_CANNOT_DECREASE: '开票或回款累计金额不能减少',
    INVALID_ORDER_AMOUNTS: '请检查合同金额和预算成本，预算不能高于合同金额',
    CUSTOMER_REQUIRED: '请填写客户名称',
    NAME_REQUIRED: '请填写项目名称',
    ACCEPTANCE_VERIFY_STAGE_REQUIRED: '只有项目进入待复验后，才能确认验收问题通过',
    ACCEPTANCE_ISSUE_MUST_BE_REPAIRED: '验收问题还未完成整改，请先标记整改完成'
  };
  function notify(text: string, isError = false) {
    const display = errorCopy[text] || text;
    if (isError) errorMessage = display; else message = display;
    window.setTimeout(() => { message = ''; errorMessage = ''; }, 3500);
  }
  async function run(action: () => Promise<void>, success: string) {
    busy = true;
    try { await action(); notify(success); }
    catch (reason) { notify(reason instanceof Error ? reason.message : '操作未完成', true); }
    finally { busy = false; }
  }
  async function reload(code = order?.code) {
    const list = await api.get<{ data: OrderSummary[] }>('/api/orders');
    orders = list.data;
    const selected = code ?? list.data[0]?.code;
    if (selected) order = (await api.get<{ data: OrderDetail }>(`/api/orders/${selected}`)).data;
  }
  async function mutate(path: string, body: Record<string, unknown>, success: string) {
    await run(async () => { await api.post(path, body); await reload(); }, success);
  }
  async function award(item: ProcurementItem, offer: { id: string; supplier: string; amount: number }) {
    busy = true;
    try {
      if (!window.confirm(`确认选择供应商“${offer.supplier}”，报价 ${money(offer.amount)} 并回写项目承诺成本吗？`)) return;
      try {
        await api.post(`/api/procurement-items/${item.id}/award`, { offer_id: offer.id });
      } catch (reason) {
        const text = reason instanceof Error ? reason.message : '';
        if (!text.includes('OVER_BUDGET_APPROVAL_REQUIRED')) throw reason;
        if (!window.confirm(`供应商报价 ${money(offer.amount)} 已超过预算 ${money(item.budget)}，确认进入审批模拟并定标吗？`)) return;
        await api.post(`/api/procurement-items/${item.id}/award`, { offer_id: offer.id, approved: true });
      }
      await reload(); notify('采购已定标，成本已回写');
    } catch (reason) { notify(reason instanceof Error ? reason.message : '采购定标失败', true); }
    finally { busy = false; }
  }
  async function resetDemo() {
    if (!order || !window.confirm('恢复当前订单的演示流程状态？已录入的业务明细会保留。')) return;
    await mutate(`/api/orders/${order.code}/reset`, {}, '演示流程已重置');
  }
  async function attachProof(expenseId: string) {
    if (!order) return;
    const name = window.prompt('凭证文件名（演示只保存文件信息，不上传二进制）', '发票或付款截图.png');
    if (!name?.trim()) return;
    await run(async () => {
      await api.post(`/api/orders/${order!.code}/attachments`, { name: name.trim(), kind: '费用凭证', related_type: 'expense', related_id: expenseId });
      await reload();
    }, '凭证已关联费用单');
  }
  async function selectView(next: View) {
    view = next;
    const orderCode = order?.code ? encodeURIComponent(order.code) : '';
    const destination = orderCode ? `/workspace/${orderCode}/${next}` : `/?view=${next}`;
    await goto(destination, { keepFocus: true, noScroll: true, replaceState: false });
  }
  async function choose(code: string) { await run(async () => { await reload(code); await selectView('dashboard'); }, '项目已切换'); }
  async function toggleTask(task: { id: string; done: number }) {
    await run(async () => { await api.post(`/api/tasks/${task.id}/toggle`, { done: !task.done }); await reload(); }, task.done ? '任务已重新打开' : '任务已完成');
  }
  async function rejectExpense(expense: { id: string }) {
    const reason = window.prompt('请输入驳回原因', '请补充合规凭证');
    if (!reason?.trim()) return;
    await mutate(`/api/expenses/${expense.id}/status`, { status: '已驳回', proof: reason.trim() }, '费用已驳回，已记录原因');
  }
  function open(kind: typeof modalKind, item: ProcurementItem | null = null) {
    modalKind = kind; targetItem = item;
    const today = new Date().toISOString().slice(0, 10);
    const defaults: Record<typeof modalKind, Record<string, string | number>> = {
      order: { customer: '', name: '', owner: '', contract_amount: 0, budget_cost: 0 },
      task: { title: '' }, expense: { category: '', occurred_on: today, amount: 0, payment_type: '员工垫付', payer: '', proof: '' },
      quote: { version: `V${(order?.quotes.length ?? 0) + 1}`, total: (order?.contract_amount ?? 0) / 100, estimated_cost: (order?.budget_cost ?? 0) / 100, proof: '客户确认邮件' },
      material: { name: '', quantity: 1, unit: '项', cost_unit: 0, supplier: '' },
      procurement: { name: '', budget: 0 }, offer: { supplier: '', amount: (item?.budget ?? 0) / 100, proof: '供应商报价单' },
      issue: { description: '', owner: '', due_date: '' }, finance: { invoice: (order?.workflow.invoice ?? 0) / 100, payment: (order?.workflow.payment ?? 0) / 100 }
    };
    form = defaults[kind]; modalOpen = true;
  }
  async function submitModal() {
    const code = order?.code;
    if (modalKind !== 'order' && !code) return;
    const paths = {
      task: `/api/orders/${code}/tasks`, expense: `/api/orders/${code}/expenses`, quote: `/api/orders/${code}/quotes`,
      material: `/api/orders/${code}/materials`, procurement: `/api/orders/${code}/procurement-items`,
      offer: `/api/procurement-items/${targetItem?.id}/offers`, issue: `/api/orders/${code}/acceptance-issues`, finance: `/api/orders/${code}/workflow`
    };
    await run(async () => {
      const result = await api.post<{ data?: OrderSummary }>(modalKind === 'order' ? '/api/orders' : paths[modalKind], form);
      modalOpen = false;
      await reload(modalKind === 'order' ? result.data?.code : code);
      if (modalKind === 'order') await selectView('quotes');
    }, '操作已保存');
  }
</script>

<svelte:head><title>ORBIT OA · 项目经营闭环</title><meta name="description" content="订单、采购、验收与财务一体化项目工作台" /></svelte:head>

<div class="app-shell">
  <aside class="sidebar">
    <div class="brand-mark"><span>O</span><div><b>ORBIT OA</b><small>项目经营闭环</small></div></div>
    <div class="workspace-label">我的工作空间</div>
    <nav class="nav" aria-label="主导航">
      {#each nav as [key, label, Icon]}
        <button class:active={view === key} onclick={() => selectView(key)} aria-current={view === key ? 'page' : undefined}>
          <Icon size={17} /><span>{label}</span>{#if view === key}<ChevronRight class="nav-arrow" size={14} />{/if}
        </button>
      {/each}
    </nav>
    <div class="sidebar-bottom"><div class="mini-user"><div class="avatar">李</div><div><b>李海明</b><small>项目负责人</small></div><span class="online"></span></div><div class="version">V4 · SvelteKit</div></div>
  </aside>

  <main class="main">
    <header class="topbar">
      <div class="breadcrumb">工作空间 <span>/</span> <b>{nav.find(([key]) => key === view)?.[1]}</b></div>
      <div class="top-actions">
        <button class="icon-btn" title="刷新数据" aria-label="刷新数据" disabled={busy} onclick={() => run(() => reload(), '数据已刷新')}><RefreshCw size={17} /></button>
        <Button size="sm" onclick={() => { if (order) window.location.href = `/api/orders/${order.code}/export`; }}>导出</Button>
        <Button size="sm" variant="danger" onclick={resetDemo}>重置</Button>
        <Button size="sm" variant="primary" onclick={() => open('order')}><Plus size={16} />新建项目</Button>
      </div>
    </header>
    {#if errorMessage}<div class="notice error" role="alert">{errorMessage}</div>{/if}

    <div class="content">
      {#if !order}
        <section class="empty-large"><FolderKanban size={34} /><b>还没有项目</b><p>创建第一个项目后即可开始业务闭环。</p><Button variant="primary" onclick={() => open('order')}><Plus size={16} />新建项目</Button></section>
      {:else if view === 'dashboard'}
        <section class="page-view">
          <div class="page-head"><div><div class="eyebrow">MONDAY · {date(new Date().toISOString())}</div><h1>先处理会影响交付的事</h1><p>需求、任务、材料、采购、凭证和审批，都围绕当前项目沉淀。</p></div><Button onclick={() => selectView('orders')}>查看重点订单 <ArrowRight size={16} /></Button></div>
          <div class="kpi-grid">
            <div class="kpi accent"><small>项目总数</small><strong>{orders.length}</strong><span>当前业务台账</span></div>
            <div class="kpi"><small>进行中项目</small><strong>{orders.filter((item) => item.stage !== '已回款').length}</strong><span>需要持续推进</span></div>
            <div class="kpi"><small>待处理工作</small><strong>{pendingTasks + openIssues}</strong><span>任务与验收问题</span></div>
            <div class="kpi"><small>待审核报销</small><strong>{pendingExpenses}</strong><span>财务待动作</span></div>
          </div>
          <section class="panel risk-panel"><div class="panel-head"><div><div class="section-kicker">风险检查</div><h2>当前风险</h2></div><span class="status-pill" class:green={!order.risk.is_risk} class:orange={order.risk.is_risk}>{order.risk.level === '低' ? '无明显风险' : `${order.risk.level}风险`}</span></div>{#if order.risk.reasons.length}<ul class="risk-reasons">{#each order.risk.reasons as reason}<li><TriangleAlert size={14} />{reason}</li>{/each}</ul>{:else}<div class="risk-clear"><CheckCircle2 size={16} />当前没有需要立即处理的风险</div>{/if}</section>
          <section class="panel workflow-panel">
            <div class="panel-head"><div><div class="section-kicker">项目流程</div><h2>项目流程</h2></div><span>下一步：{nextAction}</span></div>
            <div class="stage-flow">{#each stages as stage, index}<div class:current={stage === order.stage} class:done={stages.indexOf(order.stage) > index} class="stage-item"><i>{stages.indexOf(order.stage) > index ? '✓' : index + 1}</i><span>{stage}</span></div>{/each}</div>
            <div class="next-action"><b>当前应做</b><span>{nextAction}</span></div>
          </section>
          <div class="overview-grid">
            <section class="panel project-focus">
              <div class="panel-head"><div><div class="section-kicker">重点项目</div><h2>当前项目</h2></div><span class={`status-pill ${stageTone(order.stage)}`}>{order.stage}</span></div>
              <div class="focus-title"><div><b>{order.name}</b><span>{order.code} · {order.customer}</span></div><strong>{money(order.contract_amount)}</strong></div>
              <div class="progress-label"><span>项目闭环进度</span><b>{stageProgress(order.stage)}%</b></div><div class="progress"><i style:width={`${stageProgress(order.stage)}%`}></i></div>
              <div class="focus-meta"><span>负责人<b>{order.owner || '待分配'}</b></span><span>实际成本<b>{money(order.actual_cost)}</b></span><span>预计毛利<b class:bad={margin < 0}>{money(margin)}</b></span></div>
              <div class="quick-links"><button onclick={() => selectView('orders')}>查看订单详情 <ArrowRight size={15} /></button><button onclick={() => selectView('finance')}>查看财务跟进 <ArrowRight size={15} /></button></div>
            </section>
            <section class="panel action-panel">
              <div class="panel-head"><div><div class="section-kicker">待办事项</div><h2>今天要推进</h2></div><span class="count-badge">{pendingTasks + pendingExpenses + openIssues + pendingProcurement}</span></div>
              {#if pendingExpenses}<div class="action-item"><span class="action-icon red"><ReceiptText size={16} /></span><div><b>{pendingExpenses} 笔报销待审核</b><small>费用已经归集到当前项目</small></div><button onclick={() => selectView('expenses')}>处理 <ArrowRight size={15} /></button></div>{/if}
              {#if openIssues}<div class="action-item"><span class="action-icon amber"><TriangleAlert size={16} /></span><div><b>{openIssues} 项验收问题待整改</b><small>完成整改后才能提交复验</small></div><button onclick={() => selectView('accept')}>处理 <ArrowRight size={15} /></button></div>{/if}
              {#if !openIssues && pendingProcurement}<div class="action-item"><span class="action-icon amber"><ShoppingCart size={16} /></span><div><b>{pendingProcurement} 项采购待定标</b><small>定标后才会形成承诺成本</small></div><button onclick={() => selectView('procure')}>处理 <ArrowRight size={15} /></button></div>{/if}
              {#each order.tasks.filter((item) => !item.done).slice(0, 2) as task}<div class="action-item"><span class="action-icon blue"><ListTodo size={16} /></span><div><b>{task.title}</b><small>{order.code} · 项目工作项</small></div><button onclick={() => selectView('dashboard')}>继续 <ArrowRight size={15} /></button></div>{/each}
              {#if !pendingTasks && !pendingExpenses && !openIssues && !pendingProcurement}<div class="empty-state"><CheckCircle2 size={24} /><b>关键节点已清空</b><small>可以继续推进项目下一阶段</small></div>{/if}
            </section>
          </div>

          <section class="panel operations-panel">
            <div class="panel-head"><div><div class="section-kicker">订单流程动作</div><h2>订单执行动作</h2></div><span>当前订单：{order.code}</span></div>
            <div class="workflow-summary"><span>报价 {order.quotes.filter((item) => item.status === '草稿').length} 项待确认</span><span>采购 {order.procurement_items.filter((item) => item.status !== '已定标').length} 项待定标</span><span>验收 {openIssues} 项待整改</span><span>风险 {order.risk.level}</span></div>
            <div class="operation-columns">
              <div><h3><FileText size={16} />报价版本</h3>{#each order.quotes as quote}<div class="compact-row"><span><b>{quote.version}</b><small>{quote.status} · {money(quote.total)}</small></span>{#if quote.status === '草稿' && order.stage === '报价中'}<Button size="sm" onclick={() => mutate(`/api/quotes/${quote.id}/confirm`, { proof: quote.proof }, '报价已确认，项目进入执行中')}>确认转执行</Button>{:else if quote.status === '草稿'}<span class="status-pill orange">执行中不可确认</span>{:else}<span class="status-pill green">已确认</span>{/if}</div>{/each}<Button size="sm" onclick={() => open('quote')}><Plus size={14} />新增版本</Button></div>
              <div><h3><ShoppingCart size={16} />采购与定标</h3>{#each order!.procurement_items as item}<div class="compact-row procurement-row"><span><b>{item.name}</b><small>{item.status} · 预算 {money(item.budget)}</small>{#each item.offers ?? [] as offer}<em class="offer-line">{offer.supplier} {money(offer.amount)} {#if item.status !== '已定标'}<button class="mini-action" title={`选择供应商 ${offer.supplier}`} aria-label={`选择供应商 ${offer.supplier}`} onclick={() => award(item, offer)}>选定</button>{/if}</em>{/each}</span>{#if item.status !== '已定标'}<Button size="sm" onclick={() => open('offer', item)}>报价</Button>{:else}<span class="status-pill green">{item.supplier}</span>{/if}</div>{/each}<div class="row-actions"><Button size="sm" onclick={() => open('procurement')}><Plus size={14} />采购</Button><Button size="sm" onclick={() => open('material')}><Plus size={14} />物料成本</Button></div></div>
              <div><h3><ClipboardCheck size={16} />验收与复验</h3>{#each order!.acceptance_issues as issue}<div class="compact-row"><span><b>{issue.description}</b><small>{issue.owner || '待分配'} · {issue.status}</small></span>{#if issue.status === '待整改'}<Button size="sm" onclick={() => mutate(`/api/acceptance-issues/${issue.id}/close`, { resolution_note: '整改完成，待复验' }, '已标记整改完成')}>标记整改完成</Button>{:else if issue.status === '已整改'}<Button size="sm" variant="primary" onclick={() => mutate(`/api/acceptance-issues/${issue.id}/close`, { verify: true, resolution_note: '复验通过' }, '问题复验通过')}>复验通过</Button>{:else}<span class="status-pill green">已验收</span>{/if}</div>{/each}<div class="row-actions"><Button size="sm" onclick={() => open('issue')}><Plus size={14} />登记问题</Button>{#if order!.stage === '执行中' && !order!.workflow.submitted}<Button size="sm" variant="primary" disabled={openIssues > 0} onclick={() => mutate(`/api/orders/${order!.code}/workflow`, { submitted: true }, '已提交复验')}>提交复验</Button>{:else if order!.stage === '待复验'}<Button size="sm" variant="danger" onclick={() => mutate(`/api/orders/${order!.code}/workflow`, { submitted: false }, '已退回整改')}>退回</Button><Button size="sm" variant="primary" onclick={() => mutate(`/api/orders/${order!.code}/stage`, { stage: '已验收' }, '复验已通过')}>全部复验通过</Button>{:else if order!.stage === '已验收' && !order!.workflow.settled}<Button size="sm" variant="primary" onclick={() => { if (window.confirm(`结算前请确认：验收已通过、费用已归集、采购承诺已记录。确认将项目推进到待回款吗？`)) mutate(`/api/orders/${order!.code}/workflow`, { settled: true }, '项目已结算，下一步登记回款'); }}>结算</Button>{/if}</div></div>
            </div>
          </section>
          <section class="panel operations-panel"><div class="panel-head"><div><div class="section-kicker">项目任务</div><h2>项目任务</h2></div><Button size="sm" onclick={() => open('task')}><Plus size={14} />新增任务</Button></div>{#each order.tasks as task}<div class="task-row"><button class:completed={Boolean(task.done)} class="task-check" aria-label={task.done ? '重新打开任务' : '完成任务'} onclick={() => toggleTask(task)}>{#if task.done}✓{:else}○{/if}</button><span class:completed-text={Boolean(task.done)}>{task.title}</span><small>{task.done ? '已完成' : '待处理'}</small></div>{:else}<div class="empty">暂无项目任务，可新增一项工作安排</div>{/each}</section>
          <section class="panel timeline-panel"><div class="panel-head"><div><div class="section-kicker">项目活动记录</div><h2>项目活动流</h2></div><span>所有动作留痕</span></div><div class="timeline">{#each order.audit.slice(0, 8) as log}<div class="timeline-item"><i></i><div><b>{log.action}</b><span>{log.actor} · {date(log.created_at)}</span></div></div>{:else}<div class="empty">暂无活动记录</div>{/each}</div></section>
        </section>
      {:else if view === 'orders'}
        <section><div class="page-head"><div><div class="eyebrow">{view === 'orders' ? 'ORDER REGISTER · SINGLE SOURCE OF TRUTH' : view === 'quotes' ? 'QUOTE CONTROL · VERSION HISTORY' : view === 'procure' ? 'PROCUREMENT · COST WRITEBACK' : 'ACCEPTANCE · RECTIFICATION'}</div><h1>{view === 'orders' ? '订单台账' : view === 'quotes' ? '报价与确认' : view === 'procure' ? '采购与成本' : '验收与整改'}</h1><p>{view === 'orders' ? '订单是唯一主对象，所有业务动作从这里进入并回到这里。' : view === 'quotes' ? '版本不可覆盖，只有确认凭证才能进入正式订单。' : view === 'procure' ? '三家报价横向比较，超预算必须经过审批模拟。' : '问题、负责人、截止日和二次提交必须形成完整记录。'}</p></div><Button variant="primary" onclick={() => open('order')}><Plus size={16} />新建项目</Button></div><div class="order-filters"><input aria-label="搜索项目" placeholder="搜索项目名称、客户、编号或负责人" bind:value={orderSearch} /><select aria-label="按阶段筛选" bind:value={stageFilter}><option>全部</option>{#each stages as stage}<option>{stage}</option>{/each}</select><span>共 {filteredOrders.length} 个项目</span></div><div class="project-list">{#each filteredOrders as item}<button class="project-card" class:selected={item.code === order.code} aria-label={`打开项目 ${item.name}`} onclick={() => choose(item.code)}><div class="card-top"><span class="code">{item.code}</span><span class={`status-pill ${stageTone(item.stage)}`}>{item.stage}</span></div><h2>{item.name}</h2><p>{item.customer} · 负责人 {item.owner || '未指定'}</p><div class="card-bottom"><span>合同额<b>{money(item.contract_amount)}</b></span><span>实际成本<b>{money(item.actual_cost)}</b></span><ArrowRight size={18} /></div></button>{:else}<div class="empty">没有找到匹配的项目，请调整搜索或筛选条件</div>{/each}</div></section>
      {:else if view === 'quotes'}
        <section><div class="page-head"><div><div class="eyebrow">QUOTE CONTROL · VERSION HISTORY</div><h1>报价与确认</h1><p>版本不可覆盖，只有确认凭证才能进入正式订单。</p></div><Button variant="primary" onclick={() => open('quote')}><Plus size={16} />新建版本</Button></div><section class="panel"><div class="panel-head"><h2>{order.code} · {order.customer}</h2><span class="status-pill green">{order.stage === '报价中' ? '待转订单' : '已转订单'}</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>版本</th><th>创建时间</th><th>报价总额</th><th>预计成本</th><th>毛利率</th><th>状态</th><th>确认凭证</th><th>动作</th></tr></thead><tbody>{#each order.quotes as quote}<tr><td><b>{quote.version}</b></td><td>{date(quote.created_at)}</td><td>{money(quote.total)}</td><td>{money(quote.estimated_cost)}</td><td>{quote.total ? ((1 - quote.estimated_cost / quote.total) * 100).toFixed(1) : '0.0'}%</td><td><span class="status-pill" class:green={quote.status === '已确认'} class:orange={quote.status !== '已确认'}>{quote.status}</span></td><td>{quote.proof || '待补充'}</td><td>{#if quote.status === '草稿' && order.stage === '报价中'}<Button size="sm" variant="primary" onclick={() => mutate(`/api/quotes/${quote.id}/confirm`, { proof: quote.proof }, '报价已确认，订单已进入执行中')}>确认转执行</Button>{:else if quote.status === '草稿'}<span class="muted">订单已执行，不能确认</span>{/if}</td></tr>{/each}</tbody></table></div></section></section>
      {:else if view === 'procure'}
        <section><div class="page-head"><div><div class="eyebrow">PROCUREMENT · COST WRITEBACK</div><h1>采购与成本</h1><p>供应商报价横向比较，建议至少获取 3 家报价；超预算需确认审批，定标后回写项目承诺成本。</p></div><Button variant="primary" onclick={() => open('procurement')}><Plus size={16} />新增采购需求</Button></div>{#each order.procurement_items as item}<section class="panel section-gap"><div class="panel-head"><div><h2>{item.name}</h2><span>预算 {money(item.budget)} · 报价 {item.offers?.length ?? 0} 家{(item.offers?.length ?? 0) < 3 ? '（建议至少 3 家）' : ''}</span></div><span class="status-pill" class:green={item.status === '已定标'} class:orange={item.status !== '已定标'}>{item.status}</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>供应商</th><th>报价</th><th>预算差额</th><th>报价凭证</th><th>操作</th></tr></thead><tbody>{#each item.offers ?? [] as offer}<tr><td><b>{offer.supplier}</b></td><td>{money(offer.amount)}</td><td class:down={offer.amount > item.budget}>{offer.amount > item.budget ? '+' : ''}{money(offer.amount - item.budget)}</td><td>{offer.proof}</td><td>{#if item.status !== '已定标'}<Button size="sm" onclick={() => award(item, offer)}>选择并定标</Button>{:else}<span class="status-pill green">已定标</span>{/if}</td></tr>{:else}<tr><td colspan="5" class="empty">暂无供应商报价，请新增报价</td></tr>{/each}</tbody></table></div>{#if item.status !== '已定标'}<Button size="sm" onclick={() => open('offer', item)}><Plus size={14} />新增供应商报价</Button>{/if}</section>{/each}</section>
      {:else if view === 'accept'}
        <section><div class="page-head"><div><div class="eyebrow">ACCEPTANCE · RECTIFICATION</div><h1>验收与整改</h1><p>先完成整改，再提交复验；复验通过后项目才会进入已验收。</p></div><Button variant="primary" disabled={openIssues > 0 || order.stage !== '执行中'} onclick={() => mutate(`/api/orders/${order!.code}/workflow`, { submitted: true }, '已提交复验，等待验收')}>提交复验</Button></div><section class="panel"><div class="panel-head"><h2>{order.code} · {order.name}</h2><span class="status-pill" class:green={!openIssues} class:orange={Boolean(openIssues)}>{openIssues ? `${openIssues} 项待整改` : '整改已完成'}</span></div>{#each order.acceptance_issues as issue}<div class="metric"><span><b>{issue.description}</b><small>{issue.owner || '待分配'} · <span class:overdue={overdue(issue.due_date) && issue.status === '待整改'}>{overdue(issue.due_date) && issue.status === '待整改' ? '已逾期 · ' : ''}截止 {issue.due_date || '未设置'}</span> · {issue.status === '已整改' ? '等待复验' : issue.status}</small></span>{#if issue.status === '待整改'}<Button size="sm" onclick={() => mutate(`/api/acceptance-issues/${issue.id}/close`, { resolution_note: '整改完成，待复验' }, '已标记整改完成')}>标记整改完成</Button>{:else if issue.status === '已整改'}<Button size="sm" variant="primary" onclick={() => mutate(`/api/acceptance-issues/${issue.id}/close`, { verify: true, resolution_note: '复验通过' }, '问题复验通过')}>复验通过</Button>{:else}<span class="status-pill green">已验收</span>{/if}</div>{:else}<div class="empty">暂无验收整改问题</div>{/each}<div class="row-actions"><Button size="sm" onclick={() => open('issue')}><Plus size={14} />登记整改问题</Button>{#if order.stage === '待复验'}<Button size="sm" variant="danger" onclick={() => mutate(`/api/orders/${order!.code}/workflow`, { submitted: false }, '已退回整改')}>退回整改</Button><Button size="sm" variant="primary" onclick={() => mutate(`/api/orders/${order!.code}/stage`, { stage: '已验收' }, '复验通过')}>复验通过</Button>{/if}</div></section></section>
      {:else if view === 'finance' || view === 'expenses'}
        <section><div class="page-head"><div><div class="eyebrow">{view === 'expenses' ? 'PROJECT COST · EXPENSES & REIMBURSEMENT' : 'FINANCE · CLOSE THE LOOP'}</div><h1>{view === 'expenses' ? '项目费用与报销' : '财务跟进'}</h1><p>{view === 'expenses' ? '一个订单可以挂多张报价表、费用单和凭证，人员垫付与供应商采购分开记录。' : '开票、结算、回款三条状态线独立推进。'}</p></div><div class="hero-actions">{#if view === 'expenses'}<Button onclick={() => open('expense')}><Plus size={16} />录入费用</Button>{:else}<Button variant="primary" onclick={() => open('finance')}><Wallet size={16} />更新开票回款</Button>{/if}</div></div><div class="finance-cards"><div class="finance-card"><small>合同额</small><strong>{money(order.contract_amount)}</strong><span>客户合同口径</span></div><div class="finance-card"><small>预计成本</small><strong>{money(order.cost_summary.find((item) => item.cost_type === '预计')?.amount)}</strong><span>物料与采购计划</span></div><div class="finance-card"><small>承诺成本</small><strong>{money(order.cost_summary.find((item) => item.cost_type === '承诺')?.amount)}</strong><span>采购定标承诺</span></div><div class="finance-card"><small>实际成本</small><strong>{money(order.actual_cost)}</strong><span>已确认发生</span></div><div class="finance-card"><small>已开票</small><strong>{money(order.workflow.invoice)}</strong><span>不得超过合同额</span></div><div class="finance-card"><small>已回款</small><strong>{money(order.workflow.payment)}</strong><span>不得超过开票额</span></div></div>{#if view === 'expenses'}<section class="panel"><div class="panel-head"><div><div class="section-kicker">费用审核队列</div><h2>项目费用与报销</h2></div><span>{order.expenses.length} 笔</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>费用项目</th><th>发生日期</th><th>金额</th><th>付款主体</th><th>凭证</th><th>状态</th><th>动作</th></tr></thead><tbody>{#each order.expenses as expense}<tr><td><b>{expense.category}</b><small>{expense.payment_type}</small></td><td>{date(expense.occurred_on)}</td><td><b>{money(expense.amount)}</b></td><td>{expense.payer || '未填写'}</td><td><span class="attachment"><Paperclip size={13} />{expense.proof || '待上传'}</span><Button size="sm" onclick={() => attachProof(expense.id)}>上传凭证</Button></td><td><span class="status-pill" class:green={expense.status === '已报销'} class:orange={expense.status !== '已报销'}>{expense.status}</span></td><td>{#if expense.status === '待审核'}<div class="action-group"><Button size="sm" onclick={() => mutate(`/api/expenses/${expense.id}/status`, { status: '待报销', proof: expense.proof }, '审核已通过')}>审核通过</Button><Button size="sm" variant="danger" onclick={() => rejectExpense(expense)}>驳回</Button></div>{:else if expense.status === '已驳回'}<span class="muted">已驳回：{expense.reject_reason || expense.proof || '待补充'}</span>{:else if expense.status === '待报销'}<Button size="sm" onclick={() => mutate(`/api/expenses/${expense.id}/status`, { status: '已报销', proof: expense.proof }, '报销已完成')}>完成报销</Button>{:else}<span class="muted">已归档</span>{/if}</td></tr>{/each}</tbody></table></div></section>{/if}{#if view === 'finance'}<section class="panel section-gap"><div class="panel-head"><div><div class="section-kicker">财务明细</div><h2>发票与回款明细</h2></div><span>{order.invoices.length + order.payments.length} 笔</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>类型</th><th>单号/流水号</th><th>日期</th><th>金额</th><th>状态</th></tr></thead><tbody>{#each order.invoices as invoice}<tr><td>发票</td><td>{invoice.invoice_no}</td><td>{date(invoice.issued_on || undefined)}</td><td><b>{money(invoice.amount)}</b></td><td>{invoice.status}</td></tr>{/each}{#each order.payments as payment}<tr><td>回款</td><td>{payment.reference_no || '—'}</td><td>{date(payment.paid_on)}</td><td><b>{money(payment.amount)}</b></td><td>已到账</td></tr>{/each}{#if !order.invoices.length && !order.payments.length}<tr><td colspan="5" class="empty">暂无发票或回款明细</td></tr>{/if}</tbody></table></div></section>{/if}</section>
      {:else}
        <section><div class="page-head"><div><div class="eyebrow">WECOM PILOT · EXPENSE TO PROJECT</div><h1>企业微信入口</h1><p>报销进入项目费用台账。</p></div><Button variant="primary" onclick={() => open('expense')}><Plus size={16} />模拟提交报销</Button></div><div class="case-hero"><div class="case-icon"><MessageCircle size={27} /></div><div><b>首个企业微信试点</b><h2>报销单 → 项目归属校验 → 财务人审 → 费用回写</h2><p>企业微信负责采集和触达，项目中心负责事实、状态、凭证与审计。</p></div></div><div class="wechat-grid"><section class="panel"><div class="panel-head"><div><div class="section-kicker">PILOT FLOW</div><h2>四步跑通</h2></div><span>人工确认保留</span></div>{#each [['01','提交报销','审批单带项目号、金额和发票'],['02','归属校验','判断项目归属、预算占用和异常风险'],['03','财务人审','确认、驳回或补充凭证'],['04','回写项目','成本、预警和活动流同步更新']] as step}<div class="pilot-step"><b>{step[0]}</b><div><strong>{step[1]}</strong><small>{step[2]}</small></div></div>{/each}</section><section class="panel"><div class="panel-head"><div><div class="section-kicker">ACCEPTANCE BAR</div><h2>试点验收标准</h2></div></div><div class="metric"><strong>≥95%</strong><span>项目归属准确率</span></div><div class="metric"><strong>−50%</strong><span>财务人工处理时长目标</span></div><div class="metric"><strong>100%</strong><span>人审确认后回写成功</span></div></section></div></section>
      {/if}
    </div>
  </main>
</div>

<Modal bind:open={modalOpen} title={modalTitles[modalKind]} {busy} onsubmit={submitModal} submitLabel="保存">
  {#if modalKind === 'order'}
    <label>客户名称<input bind:value={form.customer} required /></label><label>项目名称<input bind:value={form.name} required /></label><label>负责人<input bind:value={form.owner} /></label><label>合同金额<input bind:value={form.contract_amount} type="number" min="0.01" step="0.01" required /></label><label>预算成本<input bind:value={form.budget_cost} type="number" min="0.01" step="0.01" required /></label>
  {:else if modalKind === 'task'}<label>工作内容<input bind:value={form.title} required /></label>
  {:else if modalKind === 'expense'}<label>费用项目<input bind:value={form.category} required /></label><label>发生日期<input bind:value={form.occurred_on} type="date" /></label><label>金额<input bind:value={form.amount} type="number" min="0.01" step="0.01" required /></label><label>付款主体<input bind:value={form.payer} /></label><label>凭证说明<input bind:value={form.proof} /></label>
  {:else if modalKind === 'quote'}<label>版本号<input bind:value={form.version} required /></label><label>报价总额<input bind:value={form.total} type="number" min="0.01" step="0.01" required /></label><label>预计成本<input bind:value={form.estimated_cost} type="number" min="0" step="0.01" required /></label><label>确认凭证<input bind:value={form.proof} required /></label>
  {:else if modalKind === 'material'}<label>物料名称<input bind:value={form.name} required /></label><label>数量<input bind:value={form.quantity} type="number" min="0.01" step="0.01" required /></label><label>单位<input bind:value={form.unit} required /></label><label>成本单价<input bind:value={form.cost_unit} type="number" min="0" step="0.01" required /></label><label>供应商<input bind:value={form.supplier} /></label>
  {:else if modalKind === 'procurement'}<label>采购项目<input bind:value={form.name} required /></label><label>预算金额<input bind:value={form.budget} type="number" min="0.01" step="0.01" required /></label>
  {:else if modalKind === 'offer'}<label>供应商名称<input bind:value={form.supplier} required /></label><label>报价金额<input bind:value={form.amount} type="number" min="0.01" step="0.01" required /></label><label>报价凭证<input bind:value={form.proof} required /></label>
  {:else if modalKind === 'issue'}<label>问题描述<textarea bind:value={form.description} required></textarea></label><label>整改负责人<input bind:value={form.owner} /></label><label>截止日期<input bind:value={form.due_date} type="date" /></label>
  {:else}<p class="form-hint">当前累计：已开票 {money(order?.workflow.invoice)}，已回款 {money(order?.workflow.payment)}。请输入更新后的累计金额，系统会自动记录本次新增明细。</p><label>更新后已开票累计金额<input bind:value={form.invoice} type="number" min="0" step="0.01" required /></label><label>更新后已回款累计金额<input bind:value={form.payment} type="number" min="0" step="0.01" required /></label>{/if}
</Modal>

{#if message}<div class="toast" role="status">{message}</div>{/if}
