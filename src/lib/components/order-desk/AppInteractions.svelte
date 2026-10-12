<script lang="ts">
  import { onMount, tick } from 'svelte';

  // Port of Catsco's AppTooltip timing, placement and focus policy.
  const tooltipId = 'oa-app-tooltip';
  let tooltip = $state<{ label: string; left: number; top: number; arrow: number; placement: string } | null>(null);
  let tooltipElement = $state<HTMLDivElement>();
  onMount(() => {
    let timer: ReturnType<typeof setTimeout>;
    let target: HTMLElement | null = null;
    let previousDescription: string | null = null;
    let pointer = false;
    let version = 0;
    function hide() {
      clearTimeout(timer);
      const request = ++version;
      if (target) {
        if (previousDescription) target.setAttribute('aria-describedby', previousDescription);
        else target.removeAttribute('aria-describedby');
      }
      target = null;
      queueMicrotask(() => { if (version === request) tooltip = null; });
    }
    function findTarget(eventTarget: EventTarget | null) {
      return eventTarget instanceof Element ? eventTarget.closest<HTMLElement>('button[title], button[data-cc-tooltip], [role="button"][title], [role="button"][data-cc-tooltip]') : null;
    }
    async function show(element: HTMLElement) {
      const label = element.getAttribute('title') || element.dataset.ccTooltip || '';
      if (!label || !element.isConnected) return;
      hide();
      const request = ++version;
      target = element;
      previousDescription = element.getAttribute('aria-describedby');
      element.setAttribute('aria-describedby', [previousDescription, tooltipId].filter(Boolean).join(' '));
      tooltip = { label, left: 0, top: 0, arrow: 10, placement: 'top' };
      await tick();
      if (version !== request || !tooltipElement) return;
      const rect = element.getBoundingClientRect();
      const width = tooltipElement.offsetWidth;
      const height = tooltipElement.offsetHeight;
      const center = rect.left + rect.width / 2;
      const left = Math.min(innerWidth - 8 - width / 2, Math.max(8 + width / 2, center));
      const placement = rect.top >= height + 18 ? 'top' : 'bottom';
      tooltip = { label, left, top: placement === 'top' ? rect.top - 10 : rect.bottom + 10, arrow: Math.min(width - 10, Math.max(10, center - left + width / 2)), placement };
    }
    function over(event: PointerEvent) {
      if (event.pointerType === 'touch') return;
      const element = findTarget(event.target);
      if (!element || element.contains(event.relatedTarget as Node | null)) return;
      hide();
      const label = element.getAttribute('title');
      if (label) {
        element.dataset.ccTooltip = label;
        element.removeAttribute('title');
        if (!element.textContent?.trim() && !element.hasAttribute('aria-label')) element.setAttribute('aria-label', label);
      }
      timer = setTimeout(() => show(element), 320);
    }
    function out(event: PointerEvent) {
      const element = findTarget(event.target);
      if (element && !element.contains(event.relatedTarget as Node | null)) hide();
    }
    function down(event: PointerEvent) {
      pointer = true;
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>('button, [tabindex], summary, a') : null;
      if (element) element.dataset.ccPointerFocus = 'true';
      hide();
    }
    function focus(event: FocusEvent) {
      const element = findTarget(event.target);
      if (element && !pointer) show(element);
    }
    function blur(event: FocusEvent) {
      if (event.target instanceof HTMLElement) delete event.target.dataset.ccPointerFocus;
      hide();
    }

    const dialogSelector = '[role="dialog"], [role="alertdialog"]';
    const focusable = 'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';
    let activeDialog: HTMLElement | null = null;
    const openers = new WeakMap<HTMLElement, HTMLElement | null>();
    const inertElements = new Map<HTMLElement, boolean>();
    const previousOverflow = document.body.style.overflow;
    function restoreInert() {
      for (const [element, previous] of inertElements) element.inert = previous;
      inertElements.clear();
    }
    function syncDialogs() {
      const dialogs = [...document.querySelectorAll<HTMLElement>(dialogSelector)].filter(element => element.getClientRects().length);
      const next = dialogs.at(-1) || null;
      if (next === activeDialog) return;
      const previous = activeDialog;
      restoreInert();
      activeDialog = next;
      if (next) {
        if (!openers.has(next)) openers.set(next, document.activeElement instanceof HTMLElement ? document.activeElement : null);
        // Inert siblings at each ancestor level, including underlying nested dialogs.
        for (let branch: HTMLElement | null = next; branch?.parentElement; branch = branch.parentElement) {
          for (const sibling of branch.parentElement.children) {
            if (sibling !== branch && sibling instanceof HTMLElement && sibling.tagName !== 'SCRIPT') {
              inertElements.set(sibling, sibling.inert);
              sibling.inert = true;
            }
          }
          if (branch.parentElement === document.body) break;
        }
        document.body.style.overflow = 'hidden';
        if (!next.hasAttribute('tabindex')) next.tabIndex = -1;
        if (!next.hasAttribute('aria-label') && !next.hasAttribute('aria-labelledby')) {
          next.setAttribute('aria-label', next.querySelector('h2, h3')?.textContent?.trim() || '操作窗口');
        }
        queueMicrotask(() => {
          if (activeDialog !== next) return;
          const inputs = [...next.querySelectorAll<HTMLElement>(focusable)].filter(element => element.getClientRects().length);
          (inputs.find(element => element.matches('input:not([type="checkbox"]):not([readonly]), textarea')) || inputs.find(element => element.textContent?.trim() === '取消') || inputs[0] || next).focus();
        });
      } else {
        document.body.style.overflow = previousOverflow;
      }
      if (previous && !dialogs.includes(previous)) {
        const opener = openers.get(previous);
        if (opener?.isConnected && (!next || next.contains(opener))) opener.focus();
      }
    }
    function key(event: KeyboardEvent) {
      pointer = false;
      if (document.activeElement instanceof HTMLElement) delete document.activeElement.dataset.ccPointerFocus;
      if (event.key === 'Escape') {
        hide();
        for (const details of document.querySelectorAll('details[open]')) details.removeAttribute('open');
        if (activeDialog) {
          event.stopImmediatePropagation();
          event.preventDefault();
          activeDialog.querySelector<HTMLButtonElement>('button[aria-label^="关闭"], button[aria-label^="取消"]')?.click();
        }
      }
      if (event.key === 'Tab' && activeDialog) {
        const items = [...activeDialog.querySelectorAll<HTMLElement>(focusable)].filter(element => element.getClientRects().length && !element.closest('[inert]'));
        const first = items[0];
        const last = items.at(-1);
        if (!first) { event.preventDefault(); activeDialog.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !activeDialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !activeDialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    }
    const observer = new MutationObserver(syncDialogs);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'role'] });
    syncDialogs();
    document.addEventListener('pointerover', over, true);
    document.addEventListener('pointerout', out, true);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('focusin', focus, true);
    document.addEventListener('focusout', blur, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      observer.disconnect();
      restoreInert();
      document.body.style.overflow = previousOverflow;
      hide();
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('pointerout', out, true);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('focusin', focus, true);
      document.removeEventListener('focusout', blur, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  });
</script>

{#if tooltip}<div bind:this={tooltipElement} id={tooltipId} role="tooltip" class="cc-app-tooltip" class:is-top={tooltip.placement === 'top'} class:is-bottom={tooltip.placement === 'bottom'} style:left={`${tooltip.left}px`} style:top={`${tooltip.top}px`} style:--cc-tooltip-arrow-left={`${tooltip.arrow}px`}>{tooltip.label}</div>{/if}
