<script lang="ts">
  // A group of hatched pills, the brand's background figure, drawn as one SVG so it can be anchored to a section or
  // a card. A pill is `[x, top, bottom]` in the group's own pixels; the box is the pills' extent unless one is given.
  let {
    id,
    pills,
    width = 90,
    box,
    bold = false,
    class: extra,
    style,
  }: {
    /** Unique on the page: the pattern's and the clip's ids derive from it. */
    id: string;
    pills: readonly (readonly [x: number, top: number, bottom: number])[];
    /** A pill's width; its ends are round. */
    width?: number;
    /** The drawing's own width and height, where the figure is laid out in a larger box than its pills fill. */
    box?: readonly [width: number, height: number];
    /** The hero's kind: solid with thin gaps, at full strength, rather than thin lines. */
    bold?: boolean;
    class?: string;
    style?: string;
  } = $props();

  const w = $derived(box?.[0] ?? Math.max(...pills.map(([x]) => x)) + width);
  const h = $derived(box?.[1] ?? Math.max(...pills.map(([, , bottom]) => bottom)));
</script>

<svg class={['hp', extra]} {style} viewBox="0 0 {w} {h}" aria-hidden="true"><defs>{#if bold}<pattern id="{id}p" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><rect width="18" height="18" fill="#fff"/><rect y="7.6" width="18" height="2.8" fill="#000"/></pattern><mask id="{id}m" maskUnits="userSpaceOnUse" x="0" y="0" width={w} height={h}><rect width={w} height={h} fill="url(#{id}p)"/></mask>{:else}<pattern id="{id}p" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><line x1="0" y1="8" x2="16" y2="8" stroke="var(--x)" stroke-width="1.6"/></pattern>{/if}<clipPath id="{id}c">{#each pills as [x, top, bottom] (x)}<rect {x} y={top} {width} height={bottom - top} rx={width / 2}/>{/each}</clipPath></defs>{#if bold}<rect width={w} height={h} fill="var(--x)" clip-path="url(#{id}c)" mask="url(#{id}m)"/>{:else}<rect width={w} height={h} fill="url(#{id}p)" clip-path="url(#{id}c)" opacity=".6"/>{/if}</svg>
