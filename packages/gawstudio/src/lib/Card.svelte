<script lang="ts">
  // The design's box: a rounded card with a picture behind its content, tall (750 × 950) or square.
  import type { Snippet } from 'svelte';

  let {
    image,
    square = false,
    eager = false,
    free = false,
    order = 0,
    children,
  }: { image?: string; square?: boolean; eager?: boolean; /** As tall as its content, which starts at the top: a form. */ free?: boolean; /** Its place in the phone's single column. */ order?: number; children: Snippet } = $props();
</script>

<article class={['card', square && 'sq', !image && 'plain', free && 'free']} style="--o:{order}">
  <!-- Decorative: what the card is about is in its heading. -->
  {#if image}<img src={image} alt="" width="1024" height="1024" loading={eager ? 'eager' : 'lazy'} decoding="async" />{/if}
  <div class="in">{@render children()}</div>
</article>
