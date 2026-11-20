<script lang="ts">
  import { BLOB_PATH, EXT } from './icons.ts';
  import MobileMenu from './MobileMenu.svelte';
  import type { LangLink, NavItem } from './types.ts';

  interface Labels {
    menu: string;
    close: string;
    theme: string;
    soon: string;
    /** What a screen reader hears after a link to another site: "(opens in a new tab)". */
    external?: string;
  }

  let {
    badge,
    name = 'G.A.W.Digital',
    home,
    items,
    langs,
    labels,
  }: {
    /** The site's badge, inline SVG. */
    badge: string;
    /** The site's name: the home link's accessible name. */
    name?: string;
    home: string;
    items: readonly NavItem[];
    langs: readonly LangLink[];
    labels: Labels;
  } = $props();
</script>

<svg class="blob" viewBox="0 0 1680 2207" preserveAspectRatio="none"><path style="fill:var(--blob)" d={BLOB_PATH}/></svg><div class="vig"></div><a class="home" href={home} aria-label={name}>{@html badge}</a><nav class="menu">{#each items as it (it.label)}{#if it.href === undefined}<a class="off" aria-disabled="true" title={labels.soon}>{it.label}</a>{:else if it.external}<a href={it.href} target="_blank" rel="noopener">{it.label}<span class="arr ext" aria-hidden="true">{@html EXT}</span><span class="sr">{labels.external}</span></a>{:else}<a href={it.href} class={it.current ? 'on' : undefined} aria-current={it.current ? 'page' : undefined}>{it.label}</a>{/if}{/each}</nav><MobileMenu {items} {langs} {labels} />
