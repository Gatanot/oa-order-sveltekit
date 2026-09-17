<script lang="ts">
  import { getContext } from "svelte";
  import { Download, Plus, RefreshCw } from "lucide-svelte";
  const desk = getContext<any>("order-desk");
</script>

<header class="order-topbar">
  <div>
    <span class="top-eyebrow">ENTERPRISE ORDER DESK</span>
    <h1>
      {desk.view === "overview"
        ? "订单总览"
        : desk.view === "entry"
          ? "快捷录入订单"
          : desk.view === "finance"
            ? "员工垫付 / 报销核验"
            : "报价 / 成本库"}
    </h1>
  </div>
  <div class="top-actions">
    <button class="icon-control" title="刷新数据" onclick={() => desk.refresh()}
      ><RefreshCw size={17} /></button
    >{#if desk.canFinance}<button class="outline-action" onclick={desk.openExport}
      ><Download size={16} />导出订单</button>{/if}
    {#if desk.canWrite}<button class="primary-action" onclick={() => desk.navigate("/orders/new")}
      ><Plus size={16} />录入订单</button>{/if}
  </div>
</header>
