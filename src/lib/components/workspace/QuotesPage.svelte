<script lang="ts">
  import Button from '$lib/components/Button.svelte';
  import { ArrowRight, CheckCircle2, ClipboardCheck, FileText, ListTodo, Paperclip, Plus, ReceiptText, ShoppingCart, TriangleAlert, Wallet } from 'lucide-svelte';
  import { getContext } from 'svelte';
  import type { WorkspaceContext } from '$lib/workspace-context';
  import { WORKSPACE_CONTEXT } from '$lib/workspace-context';
  import { date, money, overdue, stageProgress, stageTone } from '$lib/workspace-utils';

  const workspace = getContext<WorkspaceContext>(WORKSPACE_CONTEXT);

</script>

<section><div class="page-head"><div><div class="eyebrow">QUOTE CONTROL · VERSION HISTORY</div><h1>报价与确认</h1><p>项目首先从报价开始。创建版本、补充客户确认凭证，确认后项目才会进入执行阶段。</p></div><Button variant="primary" onclick={() => workspace.open('quote')}><Plus size={16} />新建版本</Button></div><section class="panel"><div class="panel-head"><h2>{workspace.state.order!.code} · {workspace.state.order!.customer}</h2><span class="status-pill green">{workspace.state.order!.stage === '报价中' ? '待转订单' : '已转订单'}</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>版本</th><th>创建时间</th><th>报价总额</th><th>预计成本</th><th>毛利率</th><th>状态</th><th>确认凭证</th><th>动作</th></tr></thead><tbody>{#each workspace.state.order!.quotes as quote}<tr><td><b>{quote.version}</b></td><td>{date(quote.created_at)}</td><td>{money(quote.total)}</td><td>{money(quote.estimated_cost)}</td><td>{quote.total ? ((1 - quote.estimated_cost / quote.total) * 100).toFixed(1) : '0.0'}%</td><td><span class="status-pill" class:green={quote.status === '已确认'} class:orange={quote.status !== '已确认'}>{quote.status}</span></td><td>{quote.proof || '待补充'}</td><td>{#if quote.status === '草稿' && workspace.state.order!.stage === '报价中'}<Button size="sm" variant="primary" disabled={!quote.proof?.trim()} onclick={() => workspace.mutate(`/api/quotes/${quote.id}/confirm`, { proof: quote.proof }, '报价已确认，项目已进入执行中')}>确认报价并进入执行</Button>{:else if quote.status === '草稿'}<span class="muted">订单已执行，不能确认</span>{/if}</td></tr>{/each}</tbody></table></div>{#if !workspace.state.order!.quotes.length}<div class="guided-empty"><b>还没有报价版本</b><p>请先创建一份报价，填写报价总额、预计成本和客户确认凭证。确认后项目将进入“执行中”。</p><Button variant="primary" onclick={() => workspace.open('quote')}><Plus size={14} />创建第一份报价</Button></div>{/if}</section></section>
