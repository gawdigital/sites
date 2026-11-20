<script lang="ts">
  import art_support_pix from '#lib/art/support-pix.svg?raw';
  import { ARROW } from '@gaw/ui/icons.ts';
  import Shell from '#lib/Shell.svelte';
  import { get } from '#lib/translations/index.ts';
  import ContactForm from '#lib/ContactForm.svelte';
  import type { FormState } from '@gaw/contact/states.ts';
  import { localeOf, pathOf, prefixOf } from '@gaw/i18n/locale.ts';
  import { page } from '$app/state';
  import { productFor } from '#lib/cms.ts';

  let { state }: { state?: FormState } = $props();

  const i18n = get();
  const t = i18n.t;
  const locale = $derived(localeOf(page.url.pathname));
  const prefix = $derived(prefixOf(locale));
  const href = (route: string) => pathOf(route, locale);
  const games = $derived(productFor(page.data.cms, 'games', locale, t as unknown as (key: string) => string));
  const midi = $derived(productFor(page.data.cms, 'midi-control', locale, t as unknown as (key: string) => string));
  const art: Record<string, string> = { 'support-pix': art_support_pix };
</script>

<Shell name="support" noindex={state !== undefined} title={t('support.support_g_a_w_digital')}>

  <section class="shead">
    <div class="kicker">{t('common.g_a_w_digital')}</div>
    <h1>{t('common.support')}</h1>
    <p class="lead">{t('support.help_for_g_a_w')}</p>
  </section>

  <div class="hubgrid">
  <div class="hcol">
  <div class="divider"><h2>{t('support.products')}</h2><i class="ticks"></i><span class="idx">01</span></div>
  <section class="hub">
    <article class="card prodc">
      <div class="scene"><span class="pic"><svg viewBox="0 0 1254 1254" role="img" aria-label="MIDI Control for Fireface"><use href="#appicon"/></svg></span></div><div class="fade"></div>
      <div class="content">
        <h2>{midi.name}</h2>
        <p>{midi.summary}</p>
        <p class="go"><a class="ln" href={href('/apps/midi-control/support')}>{@html t('support.support_faq', { arrow: ARROW })}</a></p>
      </div>
    </article>
    <article class="card games">
      <div class="scene sb"><div class="pixwrap">{@html art['support-pix']}</div></div><div class="fade"></div>
      <div class="content">
        <span class="tag">{t('common.coming_soon')}</span>
        <h2>{games.name}</h2>
        <p>{games.summary}</p>
      </div>
    </article>
  </section>
  </div>
  <div class="hcol">
  <div class="divider"><h2>{t('common.contact')}</h2><i class="ticks"></i><span class="idx">02</span></div>
  <ContactForm source="support" {prefix} {state} />
  </div>
  </div>

</Shell>
