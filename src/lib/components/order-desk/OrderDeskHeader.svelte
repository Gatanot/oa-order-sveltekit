<script lang="ts">
  import { getContext } from "svelte";
  import {
    Download,
    FileSpreadsheet,
    LayoutDashboard,
    ListFilter,
    Menu,
    Plus,
    RefreshCw,
    WalletCards,
    Settings,
  } from "lucide-svelte";
  const desk = getContext<any>("order-desk");
</script>

<header class="order-topbar">
  <div>
    <span class="top-eyebrow">ENTERPRISE ORDER DESK</span>
    <h1>
      {desk.view === "overdesk.view"
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
    ><button class="outline-action" onclick={desk.openExport}
      ><Download size={16} />导出订单</button
    ><button class="primary-action" onclick={() => (desk.view = "entry")}
      ><Plus size={16} />录入订单</button
    >
  </div>
</header>
