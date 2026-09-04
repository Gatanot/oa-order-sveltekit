<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    variant = 'secondary',
    size = 'md',
    loading = false,
    disabled = false,
    type = 'button',
    onclick,
    children
  }: {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md';
    loading?: boolean;
    disabled?: boolean;
    type?: 'button' | 'submit';
    onclick?: (event: MouseEvent) => void;
    children: Snippet;
  } = $props();
</script>

<button {type} class="button button--{variant} button--{size}" disabled={disabled || loading} aria-busy={loading} {onclick}>
  {#if loading}<span class="spinner" aria-hidden="true"></span>{/if}
  {@render children()}
</button>
