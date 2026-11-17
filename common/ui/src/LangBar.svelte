<script lang="ts">
  // Offers the page in the visitor's preferred language, never redirects. Hidden unless the language bar script
  // finds a better match among the offers; a visitor without JavaScript never sees it.
  import type { LangOffer } from './types.ts';

  let { offers, current }: { offers: readonly LangOffer[]; current: string } = $props();
</script>

<div class="langbar" data-current={current} hidden>{#each offers as o (o.code)}<p lang={o.code} data-locale={o.code} hidden><span>{o.text}</span> <a href={o.href} hreflang={o.code}>{o.link}</a><button class="lbx" type="button" aria-label={o.close}><svg viewBox="0 0 22 22" aria-hidden="true" focusable="false"><path d="M3 3l16 16M19 3 3 19" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></button></p>{/each}</div>
