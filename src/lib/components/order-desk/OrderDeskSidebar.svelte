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

<aside class="order-sidebar">
  <button
    class="sidebar-toggle"
    title={desk.sidebarCollapsed ? "展开菜单" : "收起菜单"}
    aria-label={desk.sidebarCollapsed ? "展开菜单" : "收起菜单"}
    onclick={() => (desk.sidebarCollapsed = !desk.sidebarCollapsed)}
    ><Menu size={18} /><span>{desk.sidebarCollapsed ? "展开" : "收起菜单"}</span
    ></button
  >
  <div class="order-brand">
    <div class="brand-mark-small">O</div>
    <div><b>ORBIT OA</b><span>订单工作台</span></div>
  </div>
  <div class="side-caption">工作台</div>
  <button
    class:active={desk.view === "overview"}
    onclick={() => (desk.view = "overview")}
    ><LayoutDashboard size={17} />订单总览</button
  >
  <button
    class:active={desk.view === "entry"}
    onclick={desk.startNewOrder}><Plus size={17} />录入订单</button
  >
  <button
    class:active={desk.view === "catalog"}
    onclick={() => (desk.view = "catalog")}
    ><FileSpreadsheet size={17} />报价成本库</button
  >
  <button
    class:active={desk.view === "finance"}
    onclick={() => (desk.view = "finance")}
    ><WalletCards size={17} />报销核验</button
  >
  <div class="sidebar-note">
    <b>{desk.creatorName || "未设置填写人"}</b><span>当前填写人</span><button
      class="settings-action"
      onclick={desk.openSettings}><Settings size={14} />设置填写人</button
    >
  </div>
</aside>
