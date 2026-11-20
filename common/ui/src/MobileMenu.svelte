<script lang="ts">
  import { CROSS, DOTS, EXT } from './icons.ts';
  import LangSwitch from './LangSwitch.svelte';
  import ThemeButton from './ThemeButton.svelte';
  import type { LangLink, NavItem } from './types.ts';

  interface Labels {
    menu: string;
    close: string;
    theme: string;
    soon: string;
    external?: string;
  }

  let { items, langs, labels }: { items: readonly NavItem[]; langs: readonly LangLink[]; labels: Labels } = $props();
</script>

<button class="mnav" type="button" aria-label={labels.menu} aria-expanded="false" aria-controls="mmenu">{@html DOTS}</button><div class="mmenu mm-a" id="mmenu" role="dialog" aria-modal="true" aria-label={labels.menu} hidden><button class="mclose" type="button" aria-label={labels.close}>{@html CROSS}</button><nav><ul>{#each items as it (it.label)}<li>{#if it.href === undefined}<span class="off" aria-disabled="true"><b>{it.label}</b><small>{labels.soon}</small></span>{:else if it.external}<a href={it.href} target="_blank" rel="noopener">{it.label}<span class="arr ext" aria-hidden="true">{@html EXT}</span><span class="sr">{labels.external}</span></a>{:else}<a href={it.href} aria-current={it.current ? 'page' : undefined}>{it.label}</a>{/if}</li>{/each}</ul></nav><div class="mfoot"><LangSwitch {langs} /><ThemeButton label={labels.theme} /></div></div>
