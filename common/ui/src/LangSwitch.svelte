<script lang="ts">
  import type { LangLink } from './types.ts';

  let { langs }: { langs: readonly LangLink[] } = $props();
</script>

<span class="lang">{#each langs as l (l.code)}{#if l.current}<!-- svelte-ignore a11y_missing_attribute (the design's current language, not a link) --><a class="cur">{l.label}</a>{:else}<a href={l.href} hreflang={l.code} lang={l.code}>{l.label}</a>{/if}{/each}</span>
