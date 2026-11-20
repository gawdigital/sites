<script lang="ts">
  // A select in a field. It has the indicator only where it is required and can be empty: with `value` given, its
  // placeholder cannot be chosen again, and the chevron is centred instead.
  import type { Choice } from './types.ts';

  let {
    label,
    name,
    options,
    placeholder,
    value,
    required = true,
    status,
  }: {
    label: string;
    name: string;
    options: readonly Choice[];
    /** The empty state's text, e.g. "Choose a product". */
    placeholder: string;
    /** The option selected from the start. */
    value?: string;
    required?: boolean;
    /** "Required, not filled in yet." in the page's language. */
    status: string;
  } = $props();

  const indicator = $derived(required && value === undefined);
</script>

<label class={['fld fbox fsel', indicator && 'req']}><span class="lb">{label}</span><select {name} {required} aria-describedby={indicator ? `st-${name}` : undefined}><option value="" disabled={required} selected={value === undefined}>{placeholder}</option>{#each options as o (o.value)}<option value={o.value} selected={o.value === value}>{o.label}</option>{/each}</select>{#if indicator}<span class="dot" aria-hidden="true"></span><span class="sr" id="st-{name}">{status}</span>{/if}</label>
