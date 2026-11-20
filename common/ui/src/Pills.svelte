<script lang="ts">
  // A group of pills under its label: radio buttons, one always chosen, so the group needs no indicator.
  import type { Choice } from './types.ts';

  let {
    label,
    name,
    options,
    value = options[0]?.value,
  }: {
    label: string;
    name: string;
    options: readonly Choice[];
    /** The pill chosen from the start: the first one unless given. */
    value?: string;
  } = $props();
</script>

<fieldset class="fld"><legend class="lb">{label}</legend><div class="seg">{#each options as o (o.value)}<label><input type="radio" {name} value={o.value} checked={o.value === value}><span>{o.label}</span></label>{/each}</div></fieldset>
