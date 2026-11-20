<script lang="ts">
  // A section's divider: its title, a rule and its number. The theme draws it (the default theme as a fader's
  // scale with the number at its end, the group's as a thin rule after the title and the number).
  let { title, index, class: extra }: { title: string; index: string; class?: string } = $props();
</script>

<div class={['divider', extra]}><h2>{title}</h2><i class="ticks"></i><span class="idx">{index}</span></div>
