<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { X } from 'lucide-svelte';
  import Button from './Button.svelte';

  let { open = $bindable(false), title, description, busy = false, onsubmit, submitLabel = '保存', children }: {
    open: boolean;
    title: string;
    description?: string;
    busy?: boolean;
    onsubmit: () => void | Promise<void>;
    submitLabel?: string;
    children: Snippet;
  } = $props();

  let dialog = $state<HTMLElement>();
  let previousFocus: HTMLElement | null = null;

  function close() { if (!busy) open = false; }
  function keydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') close();
    if (event.key !== 'Tab' || !dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute('disabled'));
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function opened(node: HTMLElement) {
    dialog = node;
    previousFocus = document.activeElement as HTMLElement;
    tick().then(() => node.querySelector<HTMLElement>('input,select,textarea,button')?.focus());
    return { destroy() { dialog = undefined; previousFocus?.focus(); } };
  }
</script>

<svelte:window onkeydown={keydown} />
{#if open}
  <div class="modal-backdrop" role="presentation" onmousedown={(event) => event.target === event.currentTarget && close()}>
    <div use:opened class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header class="modal__header">
        <div>
          <h2 id="modal-title">{title}</h2>
          {#if description}<p class="modal__description">{description}</p>{/if}
        </div>
        <button class="icon-button" type="button" aria-label="关闭" onclick={close}><X size={18} /></button>
      </header>
      <form onsubmit={(event) => { event.preventDefault(); onsubmit(); }}>
        <div class="modal__body">{@render children()}</div>
        <footer class="modal__footer">
          <Button onclick={close}>取消</Button>
          <Button type="submit" variant="primary" loading={busy}>{submitLabel}</Button>
        </footer>
      </form>
    </div>
  </div>
{/if}
