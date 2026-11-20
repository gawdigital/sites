<script lang="ts">
  // A brand's card: its badge, what it does in a few tags, a line about it and the way to its own site. The brand
  // (name, domain, address) is shared data; the tags and the line are the showing site's copy; the theme gives each
  // brand its own colours by its id.
  import type { Snippet } from 'svelte';

  import { EXT } from './icons.ts';

  let {
    brand,
    badge,
    tags,
    text,
    visit,
    external,
    children,
  }: {
    brand: { id: string; name: string; domain: string; url: string };
    /** The brand's badge, inline SVG. */
    badge: string;
    tags: readonly string[];
    text: string;
    /** The button's label: "Visit". */
    visit: string;
    /** What a screen reader hears after it: "(opens in a new tab)". */
    external: string;
    /** The card's picture, behind the text. */
    children?: Snippet;
  } = $props();
</script>

<article class={['bcard', brand.id]}>{@render children?.()}{@html badge}<div class="bbody"><div class="btags">{#each tags as tag (tag)}<span class="btag">{tag}</span>{/each}</div><h3>{brand.name}</h3><p>{text}</p><div class="brow"><span class="burl">{brand.domain}</span><a class="btn" href={brand.url} target="_blank" rel="noopener">{visit}<span class="arr ext" aria-hidden="true">{@html EXT}</span><span class="sr">{external}</span></a></div></div></article>
