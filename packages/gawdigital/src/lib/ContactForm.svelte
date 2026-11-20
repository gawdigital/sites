<script lang="ts">
  // The contact form of /contact and /support: the design's form, posting to the contact endpoint. It works without
  // JavaScript (the endpoint answers with a redirect to the form's result page), except that Turnstile needs it.
  import { PUBLIC_TURNSTILE_SITE_KEY } from '$app/env/public';
  import { CHECK } from '@gaw/ui/icons.ts';

  import { script } from './scripts.ts';
  import type { FormState } from './forms.ts';
  import { get } from './translations/index.ts';

  let {
    source,
    product,
    prefix,
    state,
  }: { source: 'contact' | 'support'; product?: 'other'; prefix: string; state?: FormState } = $props();

  const { t } = get();
  const error = $derived(state === undefined || state === 'sent' ? undefined : t(`form.${state}`));
  const messages = $derived({
    invalid: t('form.invalid'),
    verification: t('form.verification'),
    rate: t('form.rate'),
    failed: t('form.failed'),
  });
  const empty = $derived(t('common.required_not_filled_in_yet'));
</script>

<section class="contact">
    <article class={['card formc fg', state === 'sent' && 'is-sent']} id="contact">
      <div class="scene"></div>
      <form class="cform" method="post" action="/api/contact"><input type="hidden" name="locale" value={prefix.slice(1) || 'en'}><input type="hidden" name="source" value={source}>
        <label class="fld fbox req"><span class="lb">{t('common.email')}</span><input type="email" name="email" required autocomplete="email" aria-describedby="st-email" pattern="[^@\s]+@[^@\s]+\.[^@\s]+" title="name@example.com"><span class="dot" aria-hidden="true"></span><span class="sr" id="st-email">{empty}</span></label>
        <label class="fld fbox req fsel"><span class="lb">{t('common.product')}</span><select name="product" required aria-describedby="st-product"><option value="" disabled selected={product === undefined}>{t('common.choose_a_product')}</option><option value="midi-control">{t('common.midi_control_for_fireface')}</option><option value="other" selected={product === 'other'}>{t('common.other')}</option></select><span class="dot" aria-hidden="true"></span><span class="sr" id="st-product">{empty}</span></label>
        <fieldset class="fld"><legend class="lb">{t('common.topic')}</legend><div class="seg"><label><input type="radio" name="topic" value="problem" checked><span>{t('common.problem')}</span></label><label><input type="radio" name="topic" value="purchase"><span>{@html t('common.purchase_trial')}</span></label><label><input type="radio" name="topic" value="other"><span>{t('common.other')}</span></label></div></fieldset>
        <p class="fhint" id="fhint">{t('common.for_a_bug_help_report')}</p>
        <label class="fld fbox req msg"><span class="lb">{t('common.message')}</span><textarea name="message" rows="6" required maxlength="5000" aria-describedby="st-message"></textarea><span class="dot" aria-hidden="true"></span><span class="sr" id="st-message">{empty}</span></label>
        <p class="ferr" id="ferr" role="alert" hidden={error === undefined}>{error}</p>
        <div class="fend"><div class="ts" role="img" aria-label={t('common.verification')} data-sitekey={PUBLIC_TURNSTILE_SITE_KEY}><i></i><span>{t('common.verification')}</span></div>
          <button class="btn" type="submit">{t('common.send')}</button></div>
        <p class="pnote">{@html t('common.we_use_your_email_and', { p: prefix })}</p>
      </form>
      <div class="sent" role="status">{@html CHECK}<h2>{t('common.thank_you')}</h2><p>{t('common.well_reply_to_your_email')}</p></div>
    </article>
  </section>
  {@html script('form')}{@html script('fields', { FILLED: t('form.filled'), INVALID: t('form.not_valid'), EMPTY: empty })}{@html script('turnstile')}{@html script('submit', { MESSAGES: messages })}
