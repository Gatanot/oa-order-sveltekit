<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import type { Data } from './orderDeskState.svelte';
  import { createOrderDesk } from './orderDeskState.svelte';
  import OrderDeskSidebar from './OrderDeskSidebar.svelte';
  import OrderOverview from './views/OrderOverview.svelte';
  import OrderEntry from './views/OrderEntry.svelte';
  import ReimbursementReview from './views/ReimbursementReview.svelte';
  import CatalogLibrary from './views/CatalogLibrary.svelte';
  import OrderDeskModals from './OrderDeskModals.svelte';
  import AttachmentPreviewModal from './AttachmentPreviewModal.svelte';

  let { data, initialView = 'overview', orderId = '', edit = false }: { data: Data; initialView?: 'overview' | 'entry' | 'catalog' | 'finance'; orderId?: string; edit?: boolean } = $props();
  const desk = createOrderDesk(data);
  desk.view = initialView;
  setContext('order-desk', desk);
  onMount(() => {
    if (initialView === 'entry' && !orderId) {
      if (desk.workMode === 'entry') desk.startNewOrder();
      else desk.navigate('/orders');
    }
    if (orderId) {
      const order = desk.orders.find((item: any) => item.id === orderId);
      if (order) edit && desk.workMode === 'entry' ? desk.editOrder(order) : desk.openDetail(order);
    }
  });
</script>

<svelte:head><title>企业订单工作台</title><meta name="description" content="企业广告订单、报价与报销工作台" /></svelte:head>
<div class:sidebar-collapsed={desk.sidebarCollapsed} class="order-app">
  <OrderDeskSidebar />
  <main class="order-main">
    {#if desk.message}<div class="flash success">{desk.message}</div>{/if}
    {#if desk.error}<div class="flash error">{desk.error}</div>{/if}
    {#if desk.view === 'overview'}<OrderOverview />
    {:else if desk.view === 'entry'}<OrderEntry />
    {:else if desk.view === 'finance'}<ReimbursementReview />
    {:else}<CatalogLibrary />{/if}
  </main>
</div>
<OrderDeskModals />
<AttachmentPreviewModal />
