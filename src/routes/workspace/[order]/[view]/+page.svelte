<script lang="ts">
  import Workspace from '$lib/components/Workspace.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<Workspace {data} />
