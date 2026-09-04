<script lang="ts">
  import { goto } from '$app/navigation';
  import { FolderKanban, Plus } from 'lucide-svelte';
  import Button from '$lib/components/Button.svelte';
  import { api } from '$lib/api';

  let customer = $state('');
  let name = $state('');
  let owner = $state('');
  let contractAmount = $state(0);
  let budgetCost = $state(0);
  let busy = $state(false);
  let errorMessage = $state('');

  async function createProject(event: SubmitEvent) {
    event.preventDefault();
    busy = true; errorMessage = '';
    try {
      const result = await api.post<{ data?: { code?: string } }>('/api/orders', {
        customer, name, owner, contract_amount: contractAmount, budget_cost: budgetCost
      });
      if (result.data?.code) await goto(`/workspace/${encodeURIComponent(result.data.code)}/quotes`);
    } catch (reason) {
      errorMessage = reason instanceof Error ? reason.message : '项目创建失败';
    } finally { busy = false; }
  }
</script>

<svelte:head><title>ORBIT OA · 新建项目</title></svelte:head>

<main class="empty-large" style="min-height: 100vh;">
  <FolderKanban size={34} />
  <b>还没有项目</b>
  <p>创建第一个项目后即可开始业务闭环。</p>
  <form class="panel" onsubmit={createProject} style="width: min(440px, 100%); text-align: left;">
    <label>客户名称<input bind:value={customer} required /></label>
    <label>项目名称<input bind:value={name} required /></label>
    <label>负责人<input bind:value={owner} /></label>
    <label>合同金额<input bind:value={contractAmount} type="number" min="0.01" step="0.01" required /></label>
    <label>预算成本<input bind:value={budgetCost} type="number" min="0.01" step="0.01" required /></label>
    {#if errorMessage}<div class="notice error" role="alert">{errorMessage}</div>{/if}
    <Button type="submit" variant="primary" disabled={busy}><Plus size={16} />创建项目</Button>
  </form>
</main>
