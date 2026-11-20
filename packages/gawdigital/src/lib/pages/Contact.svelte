<script lang="ts">
  import { COMPANY, ibanPrinted, seatHtml } from '@gaw/company/company.ts';
  import CompanyRows from '@gaw/ui/CompanyRows.svelte';
  import { EXT } from '@gaw/ui/icons.ts';
  import Shell from '#lib/Shell.svelte';
  import { get } from '#lib/translations/index.ts';
  import ContactForm from '#lib/ContactForm.svelte';
  import { COPY, script } from '@gaw/ui/scripts.ts';
  import type { FormState } from '@gaw/contact/states.ts';
  import { localeOf, prefixOf } from '@gaw/i18n/locale.ts';
  import { page } from '$app/state';

  let { state }: { state?: FormState } = $props();

  const i18n = get();
  const t = i18n.t;
  const locale = $derived(localeOf(page.url.pathname));
  const prefix = $derived(prefixOf(locale));
  // The company's details are shared data (`@gaw/company`); only their labels are this page's copy.
  const labels = $derived({
    address: t('common.address'),
    ico: { label: t('common.company_id_i_o'), what: t('contact.company_id'), copy: t('contact.copy_company_id') },
    dic: { label: t('contact.vat_id_di'), what: t('contact.vat_id'), copy: t('contact.copy_vat_id') },
    register: t('common.register'),
    registered: t('common.registered_in_the_commercial_register', { file: COMPANY.registerFile }),
    account: t('contact.bank_account'),
    iban: { label: t('contact.iban'), what: t('contact.iban'), copy: t('contact.copy_iban') },
    bic: { label: t('contact.bic'), what: t('contact.bic'), copy: t('contact.copy_bic') },
    copy: t('contact.copy'),
  });
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
      <h2>{COMPANY.name}</h2>
      <dl><div class="crow"><dt class="lb">{t('contact.website')}</dt><dd><a class="ln" href="https://gawgroup.cz" target="_blank" rel="noopener">{@html t('contact.gawgroup_cz_opens_in_a', { ext: EXT })}</a></dd></div><CompanyRows company={COMPANY} seat={seatHtml(t('common.country'), locale)} iban={ibanPrinted()} {labels} /></dl>
      <p class="cnote" id="cnote" aria-live="polite"></p>
    </article>
  </section>
  {@html script(COPY, { COPIED: t('form.copied'), NOTE: t('form.copied_note', { what: '%s' }), COPY: t('contact.copy') })}
  </div>
  </div>

</Shell>
