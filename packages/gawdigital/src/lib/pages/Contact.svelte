<script lang="ts">
  import { EXT } from '@gaw/ui/icons.ts';
  import Shell from '#lib/Shell.svelte';
  import { get } from '#lib/translations/index.ts';
  import ContactForm from '#lib/ContactForm.svelte';
  import { COPY, script } from '@gaw/ui/scripts.ts';
  import type { FormState } from '#lib/forms.ts';
  import { localeOf, prefixOf } from '@gaw/i18n/locale.ts';
  import { page } from '$app/state';

  let { state }: { state?: FormState } = $props();

  const i18n = get();
  const t = i18n.t;
  const locale = $derived(localeOf(page.url.pathname));
  const prefix = $derived(prefixOf(locale));
</script>

<Shell name="contact" noindex={state !== undefined} title={t('contact.contact_g_a_w_digital')}>

  <section class="shead">
    <div class="kicker">{t('common.g_a_w_digital')}</div>
    <h1>{t('contact.contact')}</h1>
    <p class="lead">{t('contact.write_to_us_or_find')}</p>
  </section>

  <div class="cgrid">
  <div class="hcol">
  <div class="divider"><h2>{t('common.message')}</h2><i class="ticks"></i><span class="idx">01</span></div>
  <ContactForm source="contact" product="other" {prefix} {state} />
  </div>
  <div class="hcol">
  <div class="divider"><h2>{t('common.company')}</h2><i class="ticks"></i><span class="idx">02</span></div>
  <section class="company">
    <article class="card coc v1" id="company">
      <div class="scene"></div>
      <h2>{t('common.g_a_w_group_s')}</h2>
      <dl><div class="crow"><dt class="lb">{t('contact.website')}</dt><dd><a class="ln" href="https://gawgroup.cz" target="_blank" rel="noopener">{@html t('contact.gawgroup_cz_opens_in_a', { ext: EXT })}</a></dd></div><div class="crow"><dt class="lb">{t('common.address')}</dt><dd>{@html t('common.u_smaltovny_1375_25_170')}</dd></div><div class="crow"><dt class="lb">{t('common.company_id_i_o')}</dt><dd>21697248</dd><button class="cp" type="button" data-copy="21697248" data-what={t('contact.company_id')} aria-label={t('contact.copy_company_id')}><svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M11 3.5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><svg class="ok" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="t">{t('contact.copy')}</span></button></div><div class="crow"><dt class="lb">{t('contact.vat_id_di')}</dt><dd>{t('contact.cz21697248')}</dd><button class="cp" type="button" data-copy="CZ21697248" data-what={t('contact.vat_id')} aria-label={t('contact.copy_vat_id')}><svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M11 3.5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><svg class="ok" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="t">{t('contact.copy')}</span></button></div><div class="crow"><dt class="lb">{t('common.register')}</dt><dd>{t('common.registered_in_the_commercial_register')}</dd></div><div class="crow"><dt class="lb">{t('contact.bank_account')}</dt><dd>342384729/0300 <small>{t('contact.sob')}</small></dd></div><div class="crow"><dt class="lb">{t('contact.iban')}</dt><dd class="nw">{t('contact.cz67_0300_0000_0003_4238')}</dd><button class="cp" type="button" data-copy="CZ6703000000000342384729" data-what={t('contact.iban')} aria-label={t('contact.copy_iban')}><svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M11 3.5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><svg class="ok" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="t">{t('contact.copy')}</span></button></div><div class="crow"><dt class="lb">{t('contact.bic')}</dt><dd>{t('contact.cekoczpp')}</dd></div></dl>
      <p class="cnote" id="cnote" aria-live="polite"></p>
    </article>
  </section>
  {@html script(COPY, { COPIED: t('form.copied'), NOTE: t('form.copied_note', { what: '%s' }), COPY: t('contact.copy') })}
  </div>
  </div>

</Shell>
