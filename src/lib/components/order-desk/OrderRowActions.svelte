<script lang="ts">
  import { getContext, onMount, tick } from 'svelte';
  import { Banknote, Check, Download, Ellipsis, Trash2 } from 'lucide-svelte';
  let { order }: { order: any } = $props();
  const desk = getContext<any>('order-desk');
  let open = $state(false);
  let trigger = $state<HTMLButtonElement>();
  let menu = $state<HTMLDivElement>();
  let left = $state(0);
  let top = $state(0);
  function close(restore = false) {
    open = false;
    if (restore) trigger?.focus();
  }
  async function toggle() {
    if (open) { close(true); return; }
    const rect = trigger!.getBoundingClientRect();
    left = Math.max(8, Math.min(innerWidth - 184, rect.right - 176));
    top = rect.bottom + 6;
    open = true;
    await tick();
    if (!menu) return;
    menu.showPopover();
    if (top + menu.offsetHeight > innerHeight - 8) top = Math.max(8, rect.top - menu.offsetHeight - 6);
    menu.querySelector<HTMLButtonElement>('button')?.focus();
  }
  function key(event: KeyboardEvent) {
    if (!open) return;
    const items = [...menu!.querySelectorAll<HTMLButtonElement>('button')];
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'Tab') close(true);
  }
  function outside(event: MouseEvent) {
    if (open && !menu?.contains(event.target as Node) && !trigger?.contains(event.target as Node)) close();
  }
  function act(action: () => void) {
    close(true);
    action();
  }
  onMount(() => {
    const scroll = () => { if (open) close(!!menu?.contains(document.activeElement)); };
    window.addEventListener('scroll', scroll, true);
    return () => window.removeEventListener('scroll', scroll, true);
  });
</script>

<svelte:window onclick={outside} onpointerdown={outside} onkeydown={key} onresize={() => close()} />
<div class="order-row-actions">
  {#if desk.canCompleteOrder(order)}<button class="icon-control" type="button" title="标记完成" aria-label={`标记订单 ${order.service_name} 为已完成`} disabled={desk.busy} onclick={(event) => { event.stopPropagation(); desk.openCompleteOrder(order); }}><Check size={15} /></button>{/if}
  {#if desk.canManageOrders}<button class="icon-control payment-action" type="button" title={(order.payment_status || '未结款') === '已结款' ? '标记为未结款' : '标记为已结款'} aria-label={`切换订单 ${order.service_name} 的结款状态`} disabled={desk.busy} onclick={(event) => { event.stopPropagation(); desk.togglePaymentStatus(order); }}><Banknote size={15} /></button>{/if}
  {#if desk.canExportOrders || desk.canDeleteOrders}
    <button bind:this={trigger} class="icon-control" type="button" title="更多操作" aria-label={`订单 ${order.code} 更多操作`} aria-haspopup="menu" aria-expanded={open} disabled={desk.busy} onclick={(event) => { event.stopPropagation(); toggle(); }}><Ellipsis size={17} /></button>
  {/if}
</div>
{#if open}
  <div bind:this={menu} popover="manual" class="order-more-menu" role="menu" aria-label={`订单 ${order.code} 操作`} style:left={`${left}px`} style:top={`${top}px`}>
    {#if desk.canExportOrders}<button role="menuitem" type="button" onclick={(event) => { event.stopPropagation(); act(() => desk.openExport([order.id])); }}><Download size={16} />导出此订单</button>{/if}
    {#if desk.canDeleteOrders}<button class="danger" role="menuitem" type="button" onclick={(event) => { event.stopPropagation(); act(() => desk.deleteOrder(order)); }}><Trash2 size={16} />删除订单</button>{/if}
  </div>
{/if}
