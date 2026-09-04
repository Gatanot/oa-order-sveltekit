<script lang="ts">
  import Button from '$lib/components/Button.svelte';
  import { ArrowRight, CheckCircle2, ClipboardCheck, FileText, ListTodo, Paperclip, Plus, ReceiptText, ShoppingCart, TriangleAlert, Wallet } from 'lucide-svelte';
  import { getContext } from 'svelte';
  import type { WorkspaceContext } from '$lib/workspace-context';
  import { WORKSPACE_CONTEXT } from '$lib/workspace-context';
  import { date, money, overdue, stageProgress, stageTone } from '$lib/workspace-utils';

  const workspace = getContext<WorkspaceContext>(WORKSPACE_CONTEXT);
  const openIssues = $derived(workspace.state.order?.acceptance_issues.filter((item) => item.status === '待整改').length ?? 0);

</script>

<section><div class="page-head"><div><div class="eyebrow">ACCEPTANCE · RECTIFICATION</div><h1>验收与整改</h1><p>先完成整改，再提交复验；复验通过后项目才会进入已验收。</p></div><Button variant="primary" disabled={openIssues > 0 || workspace.state.order!.stage !== '执行中'} onclick={() => workspace.mutate(`/api/orders/${workspace.state.order!.code}/workflow`, { submitted: true }, '已提交复验，等待验收')}>提交复验</Button></div><section class="panel"><div class="panel-head"><h2>{workspace.state.order!.code} · {workspace.state.order!.name}</h2><span class="status-pill" class:green={!openIssues} class:orange={Boolean(openIssues)}>{openIssues ? `${openIssues} 项待整改` : '整改已完成'}</span></div>{#each workspace.state.order!.acceptance_issues as issue}<div class="metric"><span><b>{issue.description}</b><small>{issue.owner || '待分配'} · <span class:overdue={overdue(issue.due_date) && issue.status === '待整改'}>{overdue(issue.due_date) && issue.status === '待整改' ? '已逾期 · ' : ''}截止 {issue.due_date || '未设置'}</span> · {issue.status === '已整改' ? '等待复验' : issue.status}</small></span>{#if issue.status === '待整改'}<Button size="sm" onclick={() => workspace.mutate(`/api/acceptance-issues/${issue.id}/close`, { resolution_note: '整改完成，待复验' }, '已标记整改完成')}>标记整改完成</Button>{:else if issue.status === '已整改'}<Button size="sm" variant="primary" onclick={() => workspace.mutate(`/api/acceptance-issues/${issue.id}/close`, { verify: true, resolution_note: '复验通过' }, '问题复验通过')}>复验通过</Button>{:else}<span class="status-pill green">已验收</span>{/if}</div>{:else}<div class="empty">暂无验收整改问题</div>{/each}<div class="row-actions"><Button size="sm" onclick={() => workspace.open('issue')}><Plus size={14} />登记整改问题</Button>{#if workspace.state.order!.stage === '待复验'}<Button size="sm" variant="danger" onclick={() => workspace.mutate(`/api/orders/${workspace.state.order!.code}/workflow`, { submitted: false }, '已退回整改')}>退回整改</Button><Button size="sm" variant="primary" onclick={() => workspace.mutate(`/api/orders/${workspace.state.order!.code}/stage`, { stage: '已验收' }, '复验通过')}>复验通过</Button>{/if}</div></section></section>
