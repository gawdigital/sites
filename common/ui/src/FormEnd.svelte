<script lang="ts">
  // The form's end: the error line, the verification box beside the send button, and the privacy note under its
  // rule. The box is a placeholder until the Turnstile script puts the live widget in it.
  import type { Snippet } from 'svelte';

  let {
    error,
    verification,
    sitekey,
    children,
    note,
  }: {
    /** The error of a form's result page; the submit script fills the line in otherwise. */
    error?: string;
    /** The placeholder's text, "Verification". */
    verification: string;
    /** The Turnstile site key. */
    sitekey: string;
    /** The send button's content. */
    children: Snippet;
    /** The privacy note. */
    note?: Snippet;
  } = $props();
</script>

<p class="ferr" id="ferr" role="alert" hidden={error === undefined}>{error}</p>
<div class="fend"><div class="ts" role="img" aria-label={verification} data-sitekey={sitekey}><i></i><span>{verification}</span></div>
  <button class="btn" type="submit">{@render children()}</button></div>
{#if note}<p class="pnote">{@render note()}</p>{/if}
