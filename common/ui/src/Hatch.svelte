<script lang="ts">
  import type { HatchPin, PhoneHatchPin } from './types.ts';

  // The background hatch: placed by the hatch script, seeded by the page's name rather than its address, so a
  // page draws the same hatch in every language. A page may pin its desktop hatch to its boxes instead (`pins`):
  // each group then keeps the design's offsets from the edges of the box it hangs from, whatever the text does. The
  // phone's hatch may be hung from the cards the same way (`phone`).
  let { page, pins, phone }: { page: string; pins?: readonly HatchPin[]; phone?: readonly PhoneHatchPin[] } = $props();
</script>

<div class="bgh" aria-hidden="true" data-page={page} data-pins={pins ? JSON.stringify(pins) : undefined} data-phone={phone ? JSON.stringify(phone) : undefined}></div>
