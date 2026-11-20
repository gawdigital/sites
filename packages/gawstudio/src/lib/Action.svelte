<script lang="ts">
  // A service's second page: the form that books a recording session or orders a mix or mastering, beside where the
  // studio is or what a listener says. The fields are the shared form spec's (`@gaw/ui`). Until bookings, orders and
  // payments exist (issue #29) the form is only drawn: it cannot be sent, and its note leads to the contact page.
  import { localeOf, pathOf } from '@gaw/i18n/locale.ts';
  import Field from '@gaw/ui/Field.svelte';
  import Select from '@gaw/ui/Select.svelte';
  import TextArea from '@gaw/ui/TextArea.svelte';
  import { FIELDS, script } from '@gaw/ui/scripts.ts';
  import { page } from '$app/state';

  import Card from './Card.svelte';
  import MapCard from './MapCard.svelte';
  import Shell from './Shell.svelte';
  import { FORM_STYLES, OFFERS, type Service } from './site.ts';
  import { get } from './translations/index.ts';

  let { name, image }: { name: Service; /** The picture behind the listener's words. */ image?: string } = $props();

  const { t } = get();
  const locale = $derived(localeOf(page.url.pathname));
  const ordered = $derived(name === 'recording' ? undefined : name);
  const offer = $derived(ordered && OFFERS[ordered]);
  const action = $derived(t(offer ? 'common.order_now' : 'common.book_now'));
  const empty = $derived(t('form.required_empty'));
  const times = $derived((['morning', 'afternoon'] as const).map((value) => ({ value, label: t(`form.${value}`) })));
  const songs = Array.from({ length: 10 }, (_, i) => ({ value: `${i + 1}`, label: `${i + 1}` }));
  const price = $derived(offer && new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(offer.from));
</script>

<svelte:head>{@html FORM_STYLES}</svelte:head>

<Shell name={`${name}_action`} title={t(`${name}.action_title`)} claim={t(`${name}.claim`)} tabs={{ info: name, action: `${name}_action`, label: action }}>
  {#snippet left()}
    {#if ordered && image}
      <Card {image} eager order={2}>
        <blockquote class="quote"><p>❝ {t(`${ordered}.quote`)}</p><footer>– {t(`${ordered}.quote_by`)}</footer></blockquote>
      </Card>
    {:else}
      <MapCard order={2} />
    {/if}
  {/snippet}
  {#snippet right()}
    <Card free order={1}>
      <!-- The fields' script finds the form by this id. -->
      <div class="fg" id="contact" style="align-self:stretch">
        <form class="cform">
          {#if offer}
            <h2 class="big">{t('form.order')}</h2>
            <p>{t(`common.${name}_text`)}</p>
            <Select label={t('form.engineer')} name="engineer" options={offer.engineers.map((e) => ({ value: e, label: e }))} placeholder={t('form.choose_option')} status={empty} />
            {#if offer.preprocess}
              <label class="fsw"><input type="checkbox" name="preprocess" /><span class="sw" aria-hidden="true"></span><span><b>{t('form.preprocess')}</b>{t('form.preprocess_text')}</span></label>
            {/if}
            <Select label={t('form.tracks')} name="tracks" options={songs} placeholder="–" value="1" status={empty} />
            <Field label={t('form.link')} name="link" type="url" title="https://wetransfer.com/downloads/…" status={empty} />
            <TextArea label={t('form.notes')} name="note" rows={4} maxlength={2000} required={false} status={empty} />
            <p class="fprice">{t('form.from', { price })}</p>
          {:else}
            <h2>{t('form.when')}</h2>
            <div class="frow">
              <Field label={t('form.date')} name="date" type="date" status={empty} />
              <Select label={t('form.time')} name="time" options={times} placeholder={t('form.choose_time')} status={empty} />
            </div>
            <h2>{t('form.details')}</h2>
            <Field label={t('form.name')} name="name" autocomplete="name" status={empty} />
            <div class="frow">
              <Field label={t('form.email')} name="email" type="email" autocomplete="email" pattern="[^@\s]+@[^@\s]+\.[^@\s]+" title="name@example.com" status={empty} />
              <Field label={t('form.phone')} name="phone" type="tel" autocomplete="tel" required={false} status={empty} />
            </div>
            <TextArea label={t('form.note')} name="note" rows={4} maxlength={2000} required={false} status={empty} />
          {/if}
          <button class="btn" type="submit" disabled aria-describedby="fnote">{offer ? t('form.add_to_cart') : action}</button>
          <p class="fnote" id="fnote">{@html t(offer ? 'form.soon_order' : 'form.soon_book', { contact: pathOf('/contact', locale) })}</p>
        </form>
      </div>
    </Card>
  {/snippet}
</Shell>
{@html script(FIELDS, { FILLED: t('form.filled'), INVALID: t('form.not_valid'), EMPTY: empty })}
