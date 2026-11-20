<script lang="ts">
  // A copy button beside a value. The copy script (`COPY` in `scripts.ts`) finds it by its class, copies `value`,
  // swaps the icon for a tick and names what was copied in the page's live note (`#cnote`).
  let {
    value,
    what,
    label,
    children,
  }: {
    /** What goes to the clipboard, e.g. the IBAN without its spaces. */
    value: string;
    /** What it is, for the live note: "IBAN". */
    what: string;
    /** The button's accessible name: "Copy IBAN". */
    label: string;
    /** The button's visible text: "Copy". */
    children: import('svelte').Snippet;
  } = $props();
</script>

<button class="cp" type="button" data-copy={value} data-what={what} aria-label={label}><svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M11 3.5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><svg class="ok" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="t">{@render children()}</span></button>
