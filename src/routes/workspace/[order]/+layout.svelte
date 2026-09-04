<script lang="ts">
  import WorkspaceShell from '$lib/components/WorkspaceShell.svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
</script>

<WorkspaceShell {data}>
  {@render children()}
</WorkspaceShell>
