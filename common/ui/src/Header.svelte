<script lang="ts">
  import { BLOB_PATH } from './icons.ts';
  import MobileMenu from './MobileMenu.svelte';
  import type { LangLink, NavItem } from './types.ts';

  interface Labels {
    menu: string;
    close: string;
    theme: string;
    soon: string;
  }

  let {
    badge,
    items,
    langs,
    labels,
  }: { badge: string; items: readonly NavItem[]; langs: readonly LangLink[]; labels: Labels } = $props();
</script>

<svg class="blob" viewBox="0 0 1680 2207" preserveAspectRatio="none"><path style="fill:var(--blob)" d={BLOB_PATH}/></svg><div class="vig"></div>{@html badge}<nav class="menu">{#each items as it (it.label)}{#if it.href === undefined}<a class="off" aria-disabled="true" title={labels.soon}>{it.label}</a>{:else}<a href={it.href} class={it.current ? 'on' : undefined} aria-current={it.current ? 'page' : undefined}>{it.label}</a>{/if}{/each}</nav><MobileMenu {items} {langs} {labels} />
