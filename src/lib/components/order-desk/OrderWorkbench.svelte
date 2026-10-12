<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import type { Data } from './orderDeskState.svelte';
  import { createOrderDesk } from './orderDeskState.svelte';
  import OrderDeskSidebar from './OrderDeskSidebar.svelte';
  import OrderOverview from './views/OrderOverview.svelte';
  import OrderEntry from './views/OrderEntry.svelte';
  import Reimbursements from './views/Reimbursements.svelte';
  import ReimbursementHistory from './views/ReimbursementHistory.svelte';
  import CatalogLibrary from './views/CatalogLibrary.svelte';
  import EmployeeAdmin from './views/EmployeeAdmin.svelte';
  import OrderDeskModals from './OrderDeskModals.svelte';
  import AttachmentPreviewModal from './AttachmentPreviewModal.svelte';
  import AppInteractions from './AppInteractions.svelte';
  import { CheckCircle2, CircleAlert, Menu } from 'lucide-svelte';

  let { data, initialView = 'overview', orderId = '', edit = false }: { data: Data; initialView?: 'overview' | 'entry' | 'catalog' | 'reimbursements' | 'review' | 'history' | 'employees'; orderId?: string; edit?: boolean } = $props();
  const desk = createOrderDesk(data);
  desk.view = initialView;
  setContext('order-desk', desk);
  let collapsed = $state(false);
  let mobileOpen = $state(false);
  let sidebarWidth = $state(220);
  let resizing = $state(false);
  let mobileToggle = $state<HTMLButtonElement>();
  let finishResize: (() => void) | null = null;
  const viewLabels = { overview: '订单列表', entry: '订单录入', catalog: '报价库与成本库', reimbursements: '我的报销', review: '报销审核', history: '历史报销', employees: '员工与权限管理' };
  function persistSidebar() {
    try { localStorage.setItem('oa-sidebar', JSON.stringify({ version: 2, collapsed, width: sidebarWidth })); } catch { /* Storage can be disabled in embedded previews. */ }
  }
  function closeMobile() {
    if (!mobileOpen) return;
    mobileOpen = false;
    mobileToggle?.focus();
  }
  function resizeBy(amount: number) {
    sidebarWidth = Math.min(360, Math.max(220, sidebarWidth + amount));
    persistSidebar();
  }
  function resizeSidebar(event: PointerEvent) {
    if (event.button !== 0) return;
    finishResize?.();
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    resizing = true;
    const move = (event: PointerEvent) => { sidebarWidth = Math.min(360, Math.max(220, startWidth + event.clientX - startX)); };
    const stop = () => {
      resizing = false;
      persistSidebar();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      finishResize = null;
    };
    finishResize = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }
  onMount(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('oa-sidebar') || '{}');
      collapsed = saved.collapsed === true;
      if (Number.isFinite(saved.width)) sidebarWidth = saved.version !== 2 && saved.width === 260 ? 220 : Math.min(360, Math.max(220, saved.width));
    } catch { /* Keep defaults when storage is unavailable. */ }
    if (initialView === 'entry' && !orderId) {
      if (desk.canWrite) desk.startNewOrder();
      else desk.navigate('/orders');
    }
    if (orderId) {
      const order = desk.orders.find((item: any) => item.id === orderId);
      if (order) edit && desk.canWrite ? desk.editOrder(order) : desk.openDetail(order);
    }
    return () => finishResize?.();
  });
</script>

<svelte:head><title>企业订单工作台</title><meta name="description" content="企业广告订单、报价与报销工作台" /></svelte:head>
<svelte:window onresize={() => { if (window.innerWidth > 760 && mobileOpen) closeMobile(); }} onkeydown={(event) => { if (event.key === 'Escape' && mobileOpen) closeMobile(); }} />
<div class="order-app" class:sidebar-collapsed={collapsed} class:sidebar-resizing={resizing} style:--sidebar-width={`${collapsed ? 64 : sidebarWidth}px`}>
  {#if mobileOpen}<button class="sidebar-scrim" aria-label="关闭导航" tabindex="-1" onclick={closeMobile}></button>{/if}
  <OrderDeskSidebar {collapsed} {mobileOpen} toggle={() => { collapsed = !collapsed; persistSidebar(); }} close={closeMobile} resize={resizeSidebar} {resizeBy} />
  <main class="order-main">
    <header class="mobile-topbar"><button bind:this={mobileToggle} class="icon-control" aria-label="打开导航" aria-controls="workbench-sidebar" aria-expanded={mobileOpen} onclick={() => mobileOpen = true}><Menu size={19} /></button><b>{viewLabels[desk.view as keyof typeof viewLabels]}</b></header>
    {#if desk.view === 'overview'}<OrderOverview />
    {:else if desk.view === 'entry'}<OrderEntry />
    {:else if desk.view === 'reimbursements'}<Reimbursements mode="mine" />
    {:else if desk.view === 'review'}<Reimbursements mode="review" />
    {:else if desk.view === 'history'}<ReimbursementHistory />
    {:else if desk.view === 'employees'}<EmployeeAdmin />
    {:else}<CatalogLibrary />{/if}
  </main>
  {#if desk.message}<div class="flash success" role="status"><CheckCircle2 size={17} />{desk.message}</div>{/if}
  {#if desk.error}<div class="flash error" role="alert"><CircleAlert size={17} />{desk.error}</div>{/if}
</div>
<OrderDeskModals />
<AttachmentPreviewModal />
<AppInteractions />
