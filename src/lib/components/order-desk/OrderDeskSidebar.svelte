<script lang="ts">
  import { getContext } from "svelte";
  import { FileSpreadsheet, History, LayoutDashboard, LogIn, PanelLeftClose, PanelLeftOpen, UserCog, WalletCards, X } from "lucide-svelte";
  const desk = getContext<any>("order-desk");
  let { collapsed = false, mobileOpen = false, toggle, close, resize, resizeBy }: { collapsed?: boolean; mobileOpen?: boolean; toggle: () => void; close: () => void; resize: (event: PointerEvent) => void; resizeBy: (amount: number) => void } = $props();
  const roleLabels: Record<string, string> = { admin: '系统管理员', executor: '执行', designer: '设计师', planner: '策划', manager: '管理人员', finance: '财务', owner: '老板', pending: '待开通' };
  function navigate(path: string) {
    desk.navigate(path);
    close();
  }
</script>

<aside class="order-sidebar" class:collapsed class:mobile-open={mobileOpen} role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen ? true : undefined} aria-label="工作台导航" id="workbench-sidebar">
  <div class="order-brand"><b>广告订单 OA</b><button class="sidebar-toggle desktop-only" title={collapsed ? '展开侧栏' : '收起侧栏'} aria-label={collapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={!collapsed} onclick={toggle}>{#if collapsed}<PanelLeftOpen size={19} />{:else}<PanelLeftClose size={19} />{/if}</button><button class="sidebar-toggle mobile-only" aria-label="关闭导航" onclick={close}><X size={19} /></button></div>

  <nav class="side-nav" aria-label="主导航">
    <button class:active={desk.view === "overview" || desk.view === "entry"} aria-label="订单列表" aria-current={desk.view === 'overview' || desk.view === 'entry' ? 'page' : undefined} title={collapsed ? '订单列表' : undefined} onclick={() => navigate("/orders")}><LayoutDashboard size={17} /><span>订单列表</span></button>
    <button class:active={desk.view === "reimbursements"} aria-label="我的报销" aria-current={desk.view === 'reimbursements' ? 'page' : undefined} title={collapsed ? '我的报销' : undefined} onclick={() => navigate("/reimbursements")}><WalletCards size={17} /><span>我的报销</span></button>
    {#if desk.canReviewReimbursements}<button class:active={desk.view === "review"} aria-label="报销审核" aria-current={desk.view === 'review' ? 'page' : undefined} title={collapsed ? '报销审核' : undefined} onclick={() => navigate("/reimbursements/review")}><WalletCards size={17} /><span>报销审核</span></button>{/if}
    {#if desk.canViewAllReimbursements}<button class:active={desk.view === "history"} aria-label="历史报销" aria-current={desk.view === 'history' ? 'page' : undefined} title={collapsed ? '历史报销' : undefined} onclick={() => navigate("/reimbursements/history")}><History size={17} /><span>历史报销</span></button>{/if}
    {#if desk.canViewCatalog}<button class:active={desk.view === "catalog"} aria-label="报价库与成本库" aria-current={desk.view === 'catalog' ? 'page' : undefined} title={collapsed ? '报价库与成本库' : undefined} onclick={() => navigate("/catalog")}><FileSpreadsheet size={17} /><span>报价库与成本库</span></button>{/if}
    {#if desk.canManageEmployees || desk.canManageExecutionCompanies}<button class:active={desk.view === "employees"} aria-label={desk.canManageEmployees ? '员工与权限管理' : '执行公司管理'} aria-current={desk.view === 'employees' ? 'page' : undefined} title={collapsed ? (desk.canManageEmployees ? '员工与权限管理' : '执行公司管理') : undefined} onclick={() => navigate("/employees")}><UserCog size={17} /><span>{desk.canManageEmployees ? '员工与权限管理' : '执行公司管理'}</span></button>{/if}
  </nav>
  <div class="sidebar-note">
    <div class="sidebar-avatar" title={desk.identity?.displayName || desk.creatorName || '账户'}>{(desk.identity?.displayName || desk.creatorName || 'OA').slice(0, 1).toUpperCase()}</div>
    <div class="sidebar-profile-copy">
    {#if desk.visitor.status === "authenticated"}
      <b>{desk.visitor.username}</b><span>平台访问者 · 用户编号 {desk.visitor.uid}</span>
    {:else if desk.visitor.status === "guest"}
      <b>未识别访问者</b><span>{desk.isEmbedded ? "请在新页面完成登录" : "当前以游客身份访问"}</span>
      {#if desk.onArtifactGateway}
        <a class="settings-action" href="/_auth/start" target="_blank" rel="noreferrer"><LogIn size={14} />新页面登录</a>
      {/if}
    {:else}
      <b>{desk.identity?.displayName || desk.creatorName || "身份服务暂不可用"}</b>
    {/if}
    <span>{roleLabels[desk.identity?.role] ? `${roleLabels[desk.identity.role]}身份` : desk.workMode === "entry" ? "可新建和修改订单" : "当前仅查看业务数据"}</span>
    </div>
  </div>
  {#if !collapsed}<button class="sidebar-resize desktop-only" aria-label="调整侧栏宽度" onpointerdown={resize} onkeydown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resizeBy(event.key === 'ArrowLeft' ? -16 : 16); } }}></button>{/if}
</aside>
