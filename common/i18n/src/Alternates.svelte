<script lang="ts">
  import { alternates } from './alternates.ts';
  import { pathOf } from './locale.ts';

  let { origin, route, locale }: { origin: string; route: string; locale: string } = $props();
</script>

<link rel="canonical" href={origin + pathOf(route, locale)} />
{#each alternates(origin, route) as a (a.hreflang)}<link rel="alternate" hreflang={a.hreflang} href={a.href} />{/each}
