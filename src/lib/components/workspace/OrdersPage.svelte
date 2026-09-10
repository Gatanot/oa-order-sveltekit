<script lang="ts">
  import Button from '$lib/components/Button.svelte';
  import { ArrowRight, CheckCircle2, ClipboardCheck, FileText, ListTodo, Paperclip, Plus, ReceiptText, ShoppingCart, TriangleAlert, Wallet } from 'lucide-svelte';
  import { getContext } from 'svelte';
  import type { WorkspaceContext } from '$lib/workspace-context';
  import { WORKSPACE_CONTEXT } from '$lib/workspace-context';
  import { date, money, overdue, stageProgress, stageTone } from '$lib/workspace-utils';

  const workspace = getContext<WorkspaceContext>(WORKSPACE_CONTEXT);
  let orderSearch = $state('');
  let stageFilter = $state('全部');
  const stages = ['报价中', '执行中', '待复验', '已验收'];
  const filteredOrders = $derived(workspace.state.orders.filter((item) => {
    const keyword = orderSearch.trim().toLowerCase();
    const matchesSearch = !keyword || `${item.code} ${item.name} ${item.customer} ${item.owner}`.toLowerCase().includes(keyword);
    return matchesSearch && (stageFilter === '全部' || item.stage === stageFilter);
  }));
  async function choose(code: string) {
    await workspace.choose(code);
  }

</script>

<section><div class="page-head"><div><div class="eyebrow">{'ORDER REGISTER · SINGLE SOURCE OF TRUTH'}</div><h1>{'订单台账'}</h1><p>{'订单是唯一主对象，所有业务动作从这里进入并回到这里。'}</p></div><Button variant="primary" onclick={() => workspace.open('order')}><Plus size={16} />新建项目</Button></div><div class="order-filters"><input aria-label="搜索项目" placeholder="搜索项目名称、客户、编号或负责人" bind:value={orderSearch} /><select aria-label="按阶段筛选" bind:value={stageFilter}><option>全部</option>{#each stages as stage}<option>{stage}</option>{/each}</select><span>共 {filteredOrders.length} 个项目</span></div><div class="project-list">{#each filteredOrders as item}<button class="project-card" class:selected={item.code === workspace.state.order!.code} aria-label={`打开项目 ${item.name}`} onclick={() => workspace.choose(item.code)}><div class="card-top"><span class="code">{item.code}</span><span class={`status-pill ${stageTone(item.stage)}`}>{item.stage}</span></div><h2>{item.name}</h2><p>{item.customer} · 负责人 {item.owner || '未指定'}</p><div class="card-bottom"><span>合同额<b>{money(item.contract_amount)}</b></span><span>实际成本<b>{money(item.actual_cost)}</b></span><ArrowRight size={18} /></div></button>{:else}<div class="empty">没有找到匹配的项目，请调整搜索或筛选条件</div>{/each}</div></section>
