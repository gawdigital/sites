<script lang="ts">
  // The contact form: the shared form spec of `@gaw/ui`, posting to the contact endpoint. It works without
  // JavaScript (the endpoint answers with a redirect to the form's result page), except that Turnstile needs it.
  // The topic decides whose desk the message lands on: a brand's, or the group's.
  import { PUBLIC_GAWGROUP_TURNSTILE_SITE_KEY } from '$app/env/public';
  import type { FormState } from '@gaw/contact/states.ts';
  import Field from '@gaw/ui/Field.svelte';
  import FormCard from '@gaw/ui/FormCard.svelte';
  import FormEnd from '@gaw/ui/FormEnd.svelte';
  import { ARROW } from '@gaw/ui/icons.ts';
  import Pills from '@gaw/ui/Pills.svelte';
  import TextArea from '@gaw/ui/TextArea.svelte';
  import { FIELDS, SUBMIT, TURNSTILE, script } from '@gaw/ui/scripts.ts';

  import { TOPIC } from './scripts.ts';
  import { get } from './translations/index.ts';

  let { prefix, state }: { prefix: string; state?: FormState } = $props();

  const { t } = get();
  const error = $derived(state === undefined || state === 'sent' ? undefined : t(`form.${state}`));
  const messages = $derived({
    invalid: t('form.invalid'),
    verification: t('form.verification'),
    rate: t('form.rate'),
    failed: t('form.failed'),
  });
  const empty = $derived(t('common.required_empty'));
  const topics = $derived(
    (['digital', 'studio', 'general'] as const).map((value) => ({ value, label: t(`common.${value}`) })),
  );
</script>

<FormCard sent={state === 'sent'} thanks={t('common.thank_you')} reply={t('common.reply')}><input type="hidden" name="locale" value={prefix.slice(1) || 'en'}><input type="hidden" name="source" value="contact">
  <Field label={t('common.email')} name="email" type="email" autocomplete="email" pattern="[^@\s]+@[^@\s]+\.[^@\s]+" title="name@example.com" status={empty} />
  <Pills label={t('common.topic')} name="topic" options={topics} value="general" />
  <TextArea label={t('common.message')} name="message" maxlength={5000} status={empty} />
  <FormEnd {error} verification={t('common.verification')} sitekey={PUBLIC_GAWGROUP_TURNSTILE_SITE_KEY}>{t('common.send')}<span class="arr" aria-hidden="true">{@html ARROW}</span>{#snippet note()}{@html t('common.privacy_note', { p: prefix })}{/snippet}</FormEnd>
</FormCard>
  {@html script(TOPIC)}{@html script(FIELDS, { FILLED: t('form.filled'), INVALID: t('form.not_valid'), EMPTY: empty })}{@html script(TURNSTILE)}{@html script(SUBMIT, { MESSAGES: messages })}
