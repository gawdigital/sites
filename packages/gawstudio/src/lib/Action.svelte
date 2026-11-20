<script lang="ts">
  // A service's second page: the form that books a recording session or orders a mix or mastering, beside where the
  // studio is or how the order works. The fields are the shared form spec's (`@gaw/ui`). Until bookings, orders and
  // payments exist (issue #29) the form is only drawn: it cannot be sent, and its note leads to the contact page.
  import { localeOf, pathOf } from '@gaw/i18n/locale.ts';
  import Field from '@gaw/ui/Field.svelte';
  import Select from '@gaw/ui/Select.svelte';
  import TextArea from '@gaw/ui/TextArea.svelte';
  import { FIELDS, script } from '@gaw/ui/scripts.ts';
  import { page } from '$app/state';

  import Card from './Card.svelte';
  import HowCard from './HowCard.svelte';
  import MapCard from './MapCard.svelte';
  import Shell from './Shell.svelte';
  import { FORM_STYLES, type Service } from './site.ts';
  import { get } from './translations/index.ts';

  let { name, image }: { name: Service; /** The picture of the steps' card. */ image?: string } = $props();

  const { t } = get();
  const booked = $derived(name === 'recording');
  const action = $derived(t(booked ? 'common.book_now' : 'common.order_now'));
  const empty = $derived(t('form.required_empty'));
  const times = $derived((['morning', 'afternoon'] as const).map((value) => ({ value, label: t(`form.${value}`) })));
  const tracks = Array.from({ length: 10 }, (_, i) => ({ value: `${i + 1}`, label: `${i + 1}` }));
</script>

<svelte:head>{@html FORM_STYLES}</svelte:head>

<Shell name={`${name}_action`} title={t(`${name}.action_title`)} claim={t(`${name}.claim`)} tabs={{ info: name, action: `${name}_action`, label: action }}>
  {#snippet left()}
    {#if image}<HowCard {name} {image} order={2} />{:else}<MapCard order={2} />{/if}
  {/snippet}
  {#snippet right()}
    <Card free order={1}>
      <!-- The fields' script finds the form by this id. -->
      <div class="fg" id="contact" style="align-self:stretch">
        <form class="cform">
          {#if booked}
            <h2>{t('form.when')}</h2>
            <div class="frow">
              <Field label={t('form.date')} name="date" type="date" status={empty} />
              <Select label={t('form.time')} name="time" options={times} placeholder={t('form.choose_time')} status={empty} />
            </div>
          {:else}
            <h2>{t('form.order')}</h2>
            <Select label={t('form.tracks')} name="tracks" options={tracks} placeholder="–" value="1" status={empty} />
            <Field label={t('form.link')} name="link" type="url" title="https://we.tl/…" status={empty} />
          {/if}
          <h2>{t('form.details')}</h2>
          <Field label={t('form.name')} name="name" autocomplete="name" status={empty} />
          <div class="frow">
            <Field label={t('form.email')} name="email" type="email" autocomplete="email" pattern="[^@\s]+@[^@\s]+\.[^@\s]+" title="name@example.com" status={empty} />
            <Field label={t('form.phone')} name="phone" type="tel" autocomplete="tel" required={false} status={empty} />
          </div>
          <TextArea label={t('form.note')} name="note" rows={4} maxlength={2000} required={false} status={empty} />
          <button class="btn" type="submit" disabled aria-describedby="fnote">{action}</button>
          <p class="fnote" id="fnote">{@html t(booked ? 'form.soon_book' : 'form.soon_order', { contact: pathOf('/contact', localeOf(page.url.pathname)) })}</p>
        </form>
      </div>
    </Card>
  {/snippet}
</Shell>
{@html script(FIELDS, { FILLED: t('form.filled'), INVALID: t('form.not_valid'), EMPTY: empty })}
