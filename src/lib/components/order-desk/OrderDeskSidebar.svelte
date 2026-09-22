<script lang="ts">
  import { getContext } from "svelte";
  import { ChevronLeft, ChevronRight, FileSpreadsheet, LayoutDashboard, LogIn, WalletCards, Settings } from "lucide-svelte";
  const desk = getContext<any>("order-desk");
</script>

<aside class="order-sidebar">
  <div class="order-brand"><div><b>广告订单 OA</b><span>订单、报价与报销工作台</span></div></div>
  <div class="role-switch">
    <label for="work-mode">工作模式</label>
    <select id="work-mode" value={desk.workMode} onchange={(event) => { if (!desk.setWorkMode(event.currentTarget.value)) event.currentTarget.value = desk.workMode; }}>
      <option value="view">业务成员 · 查看</option>
      <option value="entry">{desk.creatorName || "业务成员"} · 填写</option>
      <option value="finance">财务 · 管理员</option>
    </select>
  </div>
  <nav class="side-nav" aria-label="主导航">
    <button class:active={desk.view === "overview" || desk.view === "entry"} onclick={() => desk.navigate("/orders")}><LayoutDashboard size={17} /><span>订单列表</span></button>
    <button class:active={desk.view === "finance"} onclick={() => desk.navigate("/reimbursements")}><WalletCards size={17} /><span>{desk.workMode === "finance" ? "报销审核" : "我的报销"}</span></button>
    <button class:active={desk.view === "catalog"} onclick={() => desk.navigate("/catalog")}><FileSpreadsheet size={17} /><span>报价库与成本库</span></button>
  </nav>
  <div class="sidebar-note">
    {#if desk.visitor.status === "authenticated"}
      <b>{desk.visitor.username}</b><span>平台访问者 · UID {desk.visitor.uid}</span>
    {:else if desk.visitor.status === "guest"}
      <b>未识别访问者</b><span>{desk.isEmbedded ? "请在新页面完成登录" : "当前以游客身份访问"}</span>
      {#if desk.onArtifactGateway}
        <a class="settings-action" href="/_auth/start" target="_blank" rel="noreferrer"><LogIn size={14} />新页面登录</a>
      {/if}
    {:else}
      <b>{desk.creatorName || "身份服务暂不可用"}</b><span>暂时无法核验平台访问者</span>
    {/if}
    <span>{desk.workMode === "finance" ? "财务功能已开放" : desk.workMode === "entry" ? "可新建和修改订单" : "当前仅查看业务数据"}</span>
    <button class="settings-action" onclick={desk.openSettings}><Settings size={14} />设置填写人</button>
  </div>
  <button class="sidebar-toggle" title={desk.sidebarCollapsed ? "展开菜单" : "收起菜单"} aria-label={desk.sidebarCollapsed ? "展开菜单" : "收起菜单"} onclick={() => (desk.sidebarCollapsed = !desk.sidebarCollapsed)}>{#if desk.sidebarCollapsed}<ChevronRight size={17} />{:else}<ChevronLeft size={17} /><span>收起菜单</span>{/if}</button>
</aside>
