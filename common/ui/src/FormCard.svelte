<script lang="ts">
  // The form card: the form, and the thanks that replace it once the message is sent. The forms' scripts find the
  // card by its id, so a page holds one. Without JavaScript the endpoint answers with a redirect to the form's result
  // page, which renders the card with `sent`.
  import type { Snippet } from 'svelte';

  import { CHECK } from './icons.ts';

  let {
    action = '/api/contact',
    sent = false,
    thanks,
    reply,
    children,
  }: {
    action?: string;
    sent?: boolean;
    /** The sent state's heading and the line under it. */
    thanks: string;
    reply: string;
    /** The form's hidden inputs, fields and `FormEnd`. */
    children: Snippet;
  } = $props();
</script>

<section class="contact"><article class={['card formc fg', sent && 'is-sent']} id="contact"><div class="scene"></div>
  <form class="cform" method="post" {action}>{@render children()}</form>
  <div class="sent" role="status">{@html CHECK}<h2>{thanks}</h2><p>{reply}</p></div></article></section>
