<script lang="ts">
  import { setContext } from "svelte";
  import type { Data } from "$lib/components/order-desk/orderDeskState.svelte";
  import { createOrderDesk } from "$lib/components/order-desk/orderDeskState.svelte";
  import OrderDeskSidebar from "$lib/components/order-desk/OrderDeskSidebar.svelte";
  import OrderDeskHeader from "$lib/components/order-desk/OrderDeskHeader.svelte";
  import OrderOverview from "$lib/components/order-desk/views/OrderOverview.svelte";
  import OrderEntry from "$lib/components/order-desk/views/OrderEntry.svelte";
  import ReimbursementReview from "$lib/components/order-desk/views/ReimbursementReview.svelte";
  import CatalogLibrary from "$lib/components/order-desk/views/CatalogLibrary.svelte";
  import OrderDeskModals from "$lib/components/order-desk/OrderDeskModals.svelte";

  let { data }: { data: Data } = $props();
  const desk = createOrderDesk(data);
  setContext("order-desk", desk);
</script>

<svelte:head>
  <title>企业订单工作台</title>
  <meta name="description" content="快捷录入和总览企业订单信息" />
</svelte:head>

<div class:sidebar-collapsed={desk.sidebarCollapsed} class="order-app">
  <OrderDeskSidebar />
  <main class="order-main">
    <OrderDeskHeader />
    {#if desk.message}<div class="flash success">{desk.message}</div>{/if}
    {#if desk.error}<div class="flash error">{desk.error}</div>{/if}
    {#if desk.view === "overview"}
      <OrderOverview />
    {:else if desk.view === "entry"}
      <OrderEntry />
    {:else if desk.view === "finance"}
      <ReimbursementReview />
    {:else}
      <CatalogLibrary />
    {/if}
  </main>
</div>

<OrderDeskModals />
