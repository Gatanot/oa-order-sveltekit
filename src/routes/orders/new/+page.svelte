<script lang="ts">import OrderWorkbench from '$lib/components/order-desk/OrderWorkbench.svelte'; import type { Data } from '$lib/components/order-desk/orderDeskState.svelte'; let { data }: { data: Data } = $props();</script>
<OrderWorkbench {data} initialView="entry" />
