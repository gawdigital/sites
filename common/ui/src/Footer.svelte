<script lang="ts">
  import type { Snippet } from 'svelte';

  import LangSwitch from './LangSwitch.svelte';
  import ThemeButton from './ThemeButton.svelte';
  import type { LangLink } from './types.ts';

  let { langs, themeLabel, children }: { langs: readonly LangLink[]; themeLabel: string; children: Snippet } = $props();
</script>

<footer class="footer"><div class="fl">{@render children()}</div><div class="fr"><LangSwitch {langs} /><ThemeButton label={themeLabel} /></div></footer>
