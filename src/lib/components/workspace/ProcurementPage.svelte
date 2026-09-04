<script lang="ts">
  import Button from '$lib/components/Button.svelte';
  import { ArrowRight, CheckCircle2, ClipboardCheck, FileText, ListTodo, Paperclip, Plus, ReceiptText, ShoppingCart, TriangleAlert, Wallet } from 'lucide-svelte';
  import { getContext } from 'svelte';
  import type { WorkspaceContext } from '$lib/workspace-context';
  import { WORKSPACE_CONTEXT } from '$lib/workspace-context';
  import { date, money, overdue, stageProgress, stageTone } from '$lib/workspace-utils';

  const workspace = getContext<WorkspaceContext>(WORKSPACE_CONTEXT);

</script>

<section><div class="page-head"><div><div class="eyebrow">PROCUREMENT · COST WRITEBACK</div><h1>采购与成本</h1><p>供应商报价横向比较，建议至少获取 3 家报价；超预算需确认审批，定标后回写项目承诺成本。</p></div><Button variant="primary" onclick={() => workspace.open('procurement')}><Plus size={16} />新增采购需求</Button></div>{#each workspace.state.order!.procurement_items as item}<section class="panel section-gap"><div class="panel-head"><div><h2>{item.name}</h2><span>预算 {money(item.budget)} · 报价 {item.offers?.length ?? 0} 家{(item.offers?.length ?? 0) < 3 ? '（建议至少 3 家）' : ''}</span></div><span class="status-pill" class:green={item.status === '已定标'} class:orange={item.status !== '已定标'}>{item.status}</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>供应商</th><th>报价</th><th>预算差额</th><th>报价凭证</th><th>操作</th></tr></thead><tbody>{#each item.offers ?? [] as offer}<tr><td><b>{offer.supplier}</b></td><td>{money(offer.amount)}</td><td class:down={offer.amount > item.budget}>{offer.amount > item.budget ? '+' : ''}{money(offer.amount - item.budget)}</td><td>{offer.proof}</td><td>{#if item.status !== '已定标'}<Button size="sm" onclick={() => workspace.award(item, offer)}>选择并定标</Button>{:else}<span class="status-pill green">已定标</span>{/if}</td></tr>{:else}<tr><td colspan="5" class="empty">暂无供应商报价，请新增报价</td></tr>{/each}</tbody></table></div>{#if item.status !== '已定标'}<Button size="sm" onclick={() => workspace.open('offer', item)}><Plus size={14} />新增供应商报价</Button>{/if}</section>{/each}</section>
