<script lang="ts">
  import { CROSS, DOTS } from './icons.ts';
  import LangSwitch from './LangSwitch.svelte';
  import ThemeButton from './ThemeButton.svelte';
  import type { LangLink, NavItem } from './types.ts';

  interface Labels {
    menu: string;
    close: string;
    theme: string;
    soon: string;
  }

  let { items, langs, labels }: { items: readonly NavItem[]; langs: readonly LangLink[]; labels: Labels } = $props();
</script>

<button class="mnav" type="button" aria-label={labels.menu} aria-expanded="false" aria-controls="mmenu">{@html DOTS}</button><div class="mmenu mm-a" id="mmenu" role="dialog" aria-modal="true" aria-label={labels.menu} hidden><button class="mclose" type="button" aria-label={labels.close}>{@html CROSS}</button><nav><ul>{#each items as it (it.label)}<li>{#if it.href === undefined}<span class="off" aria-disabled="true"><b>{it.label}</b><small>{labels.soon}</small></span>{:else}<a href={it.href} aria-current={it.current ? 'page' : undefined}>{it.label}</a>{/if}</li>{/each}</ul></nav><div class="mfoot"><LangSwitch {langs} /><ThemeButton label={labels.theme} /></div></div>
