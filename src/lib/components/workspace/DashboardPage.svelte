<script lang="ts">
  import Button from '$lib/components/Button.svelte';
  import { ArrowRight, CheckCircle2, ClipboardCheck, FileText, ListTodo, Paperclip, Plus, ReceiptText, ShoppingCart, TriangleAlert, Wallet } from 'lucide-svelte';
  import { getContext } from 'svelte';
  import type { WorkspaceContext } from '$lib/workspace-context';
  import { WORKSPACE_CONTEXT } from '$lib/workspace-context';
  import { date, money, overdue, stageProgress, stageTone } from '$lib/workspace-utils';

  const workspace = getContext<WorkspaceContext>(WORKSPACE_CONTEXT);
  const stages = ['报价中', '执行中', '待复验', '已验收'];
  const pendingTasks = $derived(workspace.state.order?.tasks.filter((item) => !item.done).length ?? 0);
  const pendingExpenses = $derived(workspace.state.order?.expenses.filter((item) => item.status === '待审核').length ?? 0);
  const openIssues = $derived(workspace.state.order?.acceptance_issues.filter((item) => item.status === '待整改').length ?? 0);
  const pendingProcurement = $derived(workspace.state.order?.procurement_items.filter((item) => item.status !== '已定标').length ?? 0);
  const nextAction = $derived(workspace.state.order?.stage === '报价中' ? '创建并确认客户报价' : workspace.state.order?.stage === '执行中' ? (openIssues ? `完成 ${openIssues} 项验收整改` : pendingProcurement ? `完成 ${pendingProcurement} 项采购定标` : '准备并提交复验') : workspace.state.order?.stage === '待复验' ? '等待复验通过或退回整改' : workspace.state.order?.stage === '已验收' ? '订单已完成，可归档或继续补充记录' : '项目已完成');
  const margin = $derived((workspace.state.order?.contract_amount ?? 0) - (workspace.state.order?.actual_cost ?? 0));

</script>

<section class="page-view">
          <div class="page-head"><div><div class="eyebrow">MONDAY · {date(new Date().toISOString())}</div><h1>先处理会影响交付的事</h1><p>需求、任务、材料、采购、凭证和审批，都围绕当前项目沉淀。</p></div><Button onclick={() => workspace.selectView('orders')}>查看重点订单 <ArrowRight size={16} /></Button></div>
          <div class="kpi-grid">
            <div class="kpi accent"><small>项目总数</small><strong>{workspace.state.orders.length}</strong><span>当前业务台账</span></div>
            <div class="kpi"><small>进行中项目</small><strong>{workspace.state.orders.filter((item) => item.stage !== '已验收').length}</strong><span>需要持续推进</span></div>
            <div class="kpi"><small>待处理工作</small><strong>{pendingTasks + openIssues}</strong><span>任务与验收问题</span></div>
            <div class="kpi"><small>待审核报销</small><strong>{pendingExpenses}</strong><span>财务待动作</span></div>
          </div>
          <section class="panel risk-panel"><div class="panel-head"><div><div class="section-kicker">风险检查</div><h2>当前风险</h2></div><span class="status-pill" class:green={!workspace.state.order!.risk.is_risk} class:orange={workspace.state.order!.risk.is_risk}>{workspace.state.order!.risk.level === '低' ? '无明显风险' : `${workspace.state.order!.risk.level}风险`}</span></div>{#if workspace.state.order!.risk.reasons.length}<ul class="risk-reasons">{#each workspace.state.order!.risk.reasons as reason}<li><TriangleAlert size={14} />{reason}</li>{/each}</ul>{:else}<div class="risk-clear"><CheckCircle2 size={16} />当前没有需要立即处理的风险</div>{/if}</section>
          <section class="panel workflow-panel">
            <div class="panel-head"><div><div class="section-kicker">项目流程</div><h2>项目流程</h2></div><span>下一步：{nextAction}</span></div>
            <div class="stage-flow">{#each stages as stage, index}<div class:current={stage === workspace.state.order!.stage} class:done={stages.indexOf(workspace.state.order!.stage) > index} class="stage-item"><i>{stages.indexOf(workspace.state.order!.stage) > index ? '✓' : index + 1}</i><span>{stage}</span></div>{/each}</div>
            <div class="next-action"><b>当前应做</b><span>{nextAction}</span></div>
          </section>
          <div class="overview-grid">
            <section class="panel project-focus">
              <div class="panel-head"><div><div class="section-kicker">重点项目</div><h2>当前项目</h2></div><span class={`status-pill ${stageTone(workspace.state.order!.stage)}`}>{workspace.state.order!.stage}</span></div>
              <div class="focus-title"><div><b>{workspace.state.order!.name}</b><span>{workspace.state.order!.code} · {workspace.state.order!.customer}</span></div><strong>{money(workspace.state.order!.contract_amount)}</strong></div>
              <div class="progress-label"><span>项目闭环进度</span><b>{stageProgress(workspace.state.order!.stage)}%</b></div><div class="progress"><i style:width={`${stageProgress(workspace.state.order!.stage)}%`}></i></div>
              <div class="focus-meta"><span>负责人<b>{workspace.state.order!.owner || '待分配'}</b></span><span>实际成本<b>{money(workspace.state.order!.actual_cost)}</b></span><span>预计毛利<b class:bad={margin < 0}>{money(margin)}</b></span></div>
              <div class="quick-links"><button onclick={() => workspace.selectView('orders')}>查看订单详情 <ArrowRight size={15} /></button><button onclick={() => workspace.selectView('finance')}>查看财务跟进 <ArrowRight size={15} /></button></div>
            </section>
            <section class="panel action-panel">
              <div class="panel-head"><div><div class="section-kicker">待办事项</div><h2>今天要推进</h2></div><span class="count-badge">{pendingTasks + pendingExpenses + openIssues + pendingProcurement}</span></div>
              {#if pendingExpenses}<div class="action-item"><span class="action-icon red"><ReceiptText size={16} /></span><div><b>{pendingExpenses} 笔报销待审核</b><small>费用已经归集到当前项目</small></div><button onclick={() => workspace.selectView('expenses')}>处理 <ArrowRight size={15} /></button></div>{/if}
              {#if openIssues}<div class="action-item"><span class="action-icon amber"><TriangleAlert size={16} /></span><div><b>{openIssues} 项验收问题待整改</b><small>完成整改后才能提交复验</small></div><button onclick={() => workspace.selectView('accept')}>处理 <ArrowRight size={15} /></button></div>{/if}
              {#if !openIssues && pendingProcurement}<div class="action-item"><span class="action-icon amber"><ShoppingCart size={16} /></span><div><b>{pendingProcurement} 项采购待定标</b><small>定标后才会形成承诺成本</small></div><button onclick={() => workspace.selectView('procure')}>处理 <ArrowRight size={15} /></button></div>{/if}
              {#each workspace.state.order!.tasks.filter((item) => !item.done).slice(0, 2) as task}<div class="action-item"><span class="action-icon blue"><ListTodo size={16} /></span><div><b>{task.title}</b><small>{workspace.state.order!.code} · 项目工作项</small></div><button onclick={() => workspace.selectView('dashboard')}>继续 <ArrowRight size={15} /></button></div>{/each}
              {#if !pendingTasks && !pendingExpenses && !openIssues && !pendingProcurement}<div class="empty-state"><CheckCircle2 size={24} /><b>关键节点已清空</b><small>可以继续推进项目下一阶段</small></div>{/if}
            </section>
          </div>

          <section class="panel operations-panel">
            <div class="panel-head"><div><div class="section-kicker">快捷处理</div><h2>项目执行摘要</h2></div><span>完整记录请进入左侧业务模块</span></div>
            <div class="workflow-summary"><span>报价 {workspace.state.order!.quotes.filter((item) => item.status === '草稿').length} 项待确认</span><span>采购 {workspace.state.order!.procurement_items.filter((item) => item.status !== '已定标').length} 项待定标</span><span>验收 {openIssues} 项待整改</span><span>风险 {workspace.state.order!.risk.level}</span></div>
            <div class="operation-columns">
              <div><h3><FileText size={16} />报价版本</h3>{#each workspace.state.order!.quotes as quote}<div class="compact-row"><span><b>{quote.version}</b><small>{quote.status} · {money(quote.total)}</small></span>{#if quote.status === '草稿' && workspace.state.order!.stage === '报价中'}<Button size="sm" disabled={!quote.proof?.trim()} onclick={() => workspace.mutate(`/api/quotes/${quote.id}/confirm`, { proof: quote.proof }, '报价已确认，项目已进入执行中')}>确认报价并进入执行</Button>{:else if quote.status === '草稿'}<span class="status-pill orange">执行中不可确认</span>{:else}<span class="status-pill green">已确认</span>{/if}</div>{/each}<Button size="sm" onclick={() => workspace.open('quote')}><Plus size={14} />新增版本</Button></div>
              <div><h3><ShoppingCart size={16} />采购与定标</h3>{#each workspace.state.order!.procurement_items as item}<div class="compact-row procurement-row"><span><b>{item.name}</b><small>{item.status} · 预算 {money(item.budget)}</small>{#each item.offers ?? [] as offer}<em class="offer-line">{offer.supplier} {money(offer.amount)} {#if item.status !== '已定标'}<button class="mini-action" title={`选择供应商 ${offer.supplier}`} aria-label={`选择供应商 ${offer.supplier}`} onclick={() => workspace.award(item, offer)}>选定</button>{/if}</em>{/each}</span>{#if item.status !== '已定标'}<Button size="sm" onclick={() => workspace.selectView('procure')}>查看采购</Button>{:else}<span class="status-pill green">{item.supplier}</span>{/if}</div>{/each}<div class="row-actions"><Button size="sm" onclick={() => workspace.open('procurement')}><Plus size={14} />采购</Button><Button size="sm" onclick={() => workspace.open('material')}><Plus size={14} />物料成本</Button></div></div>
              <div><h3><ClipboardCheck size={16} />验收与复验</h3>{#each workspace.state.order!.acceptance_issues as issue}<div class="compact-row"><span><b>{issue.description}</b><small>{issue.owner || '待分配'} · {issue.status}</small></span>{#if issue.status === '待整改'}<Button size="sm" onclick={() => workspace.mutate(`/api/acceptance-issues/${issue.id}/close`, { resolution_note: '整改完成，待复验' }, '已标记整改完成')}>标记整改完成</Button>{:else if issue.status === '已整改'}<Button size="sm" variant="primary" onclick={() => workspace.mutate(`/api/acceptance-issues/${issue.id}/close`, { verify: true, resolution_note: '复验通过' }, '问题复验通过')}>复验通过</Button>{:else}<span class="status-pill green">已验收</span>{/if}</div>{/each}<div class="row-actions"><Button size="sm" onclick={() => workspace.selectView('accept')}>查看验收</Button>{#if workspace.state.order!.stage === '执行中' && !workspace.state.order!.workflow.submitted}<Button size="sm" variant="primary" disabled={openIssues > 0} onclick={() => workspace.mutate(`/api/orders/${workspace.state.order!.code}/workflow`, { submitted: true }, '已提交复验')}>提交复验</Button>{:else if workspace.state.order!.stage === '待复验'}<Button size="sm" variant="danger" onclick={() => workspace.mutate(`/api/orders/${workspace.state.order!.code}/workflow`, { submitted: false }, '已退回整改')}>退回</Button><Button size="sm" variant="primary" onclick={() => { if (window.confirm('确认所有整改问题均已复验通过？项目将进入“已验收”，之后可以进行结算。')) workspace.mutate(`/api/orders/${workspace.state.order!.code}/stage`, { stage: '已验收' }, '复验已通过'); }}>确认复验通过</Button>{/if}</div></div>
            </div>
          </section>
          <section class="panel operations-panel"><div class="panel-head"><div><div class="section-kicker">项目任务</div><h2>项目任务</h2></div><Button size="sm" onclick={() => workspace.open('task')}><Plus size={14} />新增任务</Button></div>{#each workspace.state.order!.tasks as task}<div class="task-row"><button class:completed={Boolean(task.done)} class="task-check" aria-label={task.done ? '重新打开任务' : '完成任务'} onclick={() => workspace.toggleTask(task)}>{#if task.done}✓{:else}○{/if}</button><span class:completed-text={Boolean(task.done)}>{task.title}</span><small>{task.done ? '已完成' : '待处理'}</small></div>{:else}<div class="empty">暂无项目任务，可新增一项工作安排</div>{/each}</section>
          <section class="panel timeline-panel"><div class="panel-head"><div><div class="section-kicker">项目活动记录</div><h2>项目活动流</h2></div><span>所有动作留痕</span></div><div class="timeline">{#each workspace.state.order!.audit.slice(0, 8) as log}<div class="timeline-item"><i></i><div><b>{log.action}</b><span>{log.actor} · {date(log.created_at)}</span></div></div>{:else}<div class="empty">暂无活动记录</div>{/each}</div></section>
        </section>
