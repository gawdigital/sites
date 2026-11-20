<script lang="ts">
  import { use } from '#lib/translations/index.ts';

  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();

  // Provides the instance to every page below, the error page included.
  use(() => data);
</script>

{@render children()}
