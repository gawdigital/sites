<script lang="ts">
  // The contact form of /contact and /support: the design's form, posting to the contact endpoint. It works without
  // JavaScript (the endpoint answers with a redirect to the form's result page), except that Turnstile needs it.
  // Its markup, styles and scripts are the shared form spec of `@gaw/ui`; the fields, the copy and the hint are its own.
  import { PUBLIC_TURNSTILE_SITE_KEY } from '$app/env/public';
  import Field from '@gaw/ui/Field.svelte';
  import FormCard from '@gaw/ui/FormCard.svelte';
  import FormEnd from '@gaw/ui/FormEnd.svelte';
  import Pills from '@gaw/ui/Pills.svelte';
  import Select from '@gaw/ui/Select.svelte';
  import TextArea from '@gaw/ui/TextArea.svelte';
  import { FIELDS, SUBMIT, TURNSTILE, script } from '@gaw/ui/scripts.ts';

  import { FORM } from './scripts.ts';
  import type { FormState } from '@gaw/contact/states.ts';
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
  const products = $derived([
    { value: 'midi-control', label: t('common.midi_control_for_fireface') },
    { value: 'other', label: t('common.other') },
  ]);
  const topics = $derived([
    { value: 'problem', label: t('common.problem') },
    { value: 'purchase', label: t('common.purchase_trial') },
    { value: 'other', label: t('common.other') },
  ]);
</script>

<FormCard sent={state === 'sent'} thanks={t('common.thank_you')} reply={t('common.well_reply_to_your_email')}><input type="hidden" name="locale" value={prefix.slice(1) || 'en'}><input type="hidden" name="source" value={source}>
  <Field label={t('common.email')} name="email" type="email" autocomplete="email" pattern="[^@\s]+@[^@\s]+\.[^@\s]+" title="name@example.com" status={empty} />
  <!-- the select has the indicator only where it can be empty: with a product preselected its placeholder cannot be chosen -->
  <Select label={t('common.product')} name="product" placeholder={t('common.choose_a_product')} value={product} options={products} status={empty} />
  <Pills label={t('common.topic')} name="topic" options={topics} />
  <p class="fhint" id="fhint">{t('common.for_a_bug_help_report')}</p>
  <TextArea label={t('common.message')} name="message" maxlength={5000} status={empty} />
  <FormEnd {error} verification={t('common.verification')} sitekey={PUBLIC_TURNSTILE_SITE_KEY}>{t('common.send')}{#snippet note()}{@html t('common.we_use_your_email_and', { p: prefix })}{/snippet}</FormEnd>
</FormCard>
  {@html script(FORM)}{@html script(FIELDS, { FILLED: t('form.filled'), INVALID: t('form.not_valid'), EMPTY: empty })}{@html script(TURNSTILE)}{@html script(SUBMIT, { MESSAGES: messages })}
