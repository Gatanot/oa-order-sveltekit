<script lang="ts">
  import { getContext } from "svelte";
  import { FileSpreadsheet, LayoutDashboard, Menu, Plus, WalletCards, Settings } from "lucide-svelte";
  const desk = getContext<any>("order-desk");
</script>

<aside class="order-sidebar">
  <button class="sidebar-toggle" title={desk.sidebarCollapsed ? "展开菜单" : "收起菜单"} aria-label={desk.sidebarCollapsed ? "展开菜单" : "收起菜单"} onclick={() => (desk.sidebarCollapsed = !desk.sidebarCollapsed)}><Menu size={18} /><span>{desk.sidebarCollapsed ? "展开" : "收起菜单"}</span></button>
  <div class="order-brand"><div class="brand-mark-small">O</div><div><b>ORBIT OA</b><span>订单工作台</span></div></div>
  <div class="side-caption">工作模式</div>
  <div class="mode-switch" role="group" aria-label="切换工作模式">
    <button class:active={desk.workMode === "view"} onclick={() => desk.setWorkMode("view")}>查看</button>
    <button class:active={desk.workMode === "entry"} onclick={() => desk.setWorkMode("entry")}>填写</button>
    <button class:active={desk.workMode === "finance"} onclick={() => desk.setWorkMode("finance")}>财务</button>
  </div>
  <div class="account-summary"><span>当前填写人</span><b>{desk.creatorName || "未设置"}</b><small>{desk.workMode === "finance" ? "财务功能已开放" : desk.workMode === "entry" ? "可新建和修改订单" : "只查看业务数据"}</small></div>
  <button class:active={desk.view === "overview"} onclick={() => desk.navigate("/orders")}><LayoutDashboard size={17} />订单总览</button>
  <button class:active={desk.view === "entry"} disabled={desk.workMode !== "entry"} onclick={() => desk.navigate("/orders/new")}><Plus size={17} />录入订单</button>
  <button class:active={desk.view === "catalog"} disabled={desk.workMode !== "finance"} onclick={() => desk.navigate("/catalog")}><FileSpreadsheet size={17} />报价成本库</button>
  <button class:active={desk.view === "finance"} onclick={() => desk.navigate("/reimbursements")}><WalletCards size={17} />报销工作台</button>
  <div class="sidebar-note"><b>{desk.creatorName || "请设置填写人"}</b><span>模式：{desk.workMode === "finance" ? "财务" : desk.workMode === "entry" ? "填写" : "查看"}</span><button class="settings-action" onclick={desk.openSettings}><Settings size={14} />设置填写人</button></div>
</aside>
