<script lang="ts">
  import type { HatchPin } from './types.ts';

  // The background hatch: placed by the hatch script, seeded by the page's name rather than its address, so a
  // page draws the same hatch in every language. A page may pin its desktop hatch to its boxes instead (`pins`):
  // each group then keeps the design's offsets from the edges of the box it hangs from, whatever the text does.
  let { page, pins }: { page: string; pins?: readonly HatchPin[] } = $props();
</script>

<div class="bgh" aria-hidden="true" data-page={page} data-pins={pins ? JSON.stringify(pins) : undefined}></div>
