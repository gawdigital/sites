<script lang="ts">
  import { BRANDS } from '@gaw/company/brands.ts';
  import { COMPANY, ibanPrinted, seatHtml } from '@gaw/company/company.ts';
  import type { FormState } from '@gaw/contact/states.ts';
  import { localeOf, prefixOf } from '@gaw/i18n/locale.ts';
  import CompanyRows from '@gaw/ui/CompanyRows.svelte';
  import Divider from '@gaw/ui/Divider.svelte';
  import HatchPills from '@gaw/ui/HatchPills.svelte';
  import { EXT } from '@gaw/ui/icons.ts';
  import { COPY, script } from '@gaw/ui/scripts.ts';
  import { page } from '$app/state';

  import ContactForm from '#lib/ContactForm.svelte';
  import { place } from '#lib/hatch.ts';
  import Shell from '#lib/Shell.svelte';
  import { get } from '#lib/translations/index.ts';

  let { state }: { state?: FormState } = $props();

  const { t } = get();
  const locale = $derived(localeOf(page.url.pathname));
  const prefix = $derived(prefixOf(locale));
  // The company's details are shared data (`@gaw/company`); only their labels are this page's copy.
  const labels = $derived({
    address: t('common.address'),
    ico: { label: t('common.company_id_label'), what: t('contact.company_id'), copy: t('contact.copy_company_id') },
    dic: { label: t('contact.vat_id_label'), what: t('contact.vat_id'), copy: t('contact.copy_vat_id') },
    register: t('common.register'),
    registered: t('common.registered', { file: COMPANY.registerFile }),
    account: t('contact.bank_account'),
    iban: { label: t('contact.iban'), what: t('contact.iban'), copy: t('contact.copy_iban') },
    bic: t('contact.bic'),
    copy: t('contact.copy'),
  });
  // The phone's hatches, in the frame's coordinates.
  const phone = [
    place([[175, 350, 480], [260, 340, 560], [345, 360, 520]], 48),
    place([[200, 985, 1215], [285, 955, 1265], [370, 1005, 1195]], 48),
    place([[-20, 1848, 2058], [65, 1808, 2078], [150, 1878, 2063]], 48),
  ];
</script>

<Shell name="contact" noindex={state !== undefined} title={t('contact.page_title')}>
  {#snippet before()}{#each phone as group, i (i)}<HatchPills id="hc{i}" width={48} pills={group.pills} class="hmc" style={group.style} />{/each}{/snippet}

  <section class="shead">
    <HatchPills id="ht" box={[500, 470]} pills={[[0, 60, 340], [160, 0, 470], [320, 180, 360]]} class="hx-top" />
    <div class="kicker">{t('common.group')}</div>
    <h1>{t('contact.heading')}</h1>
    <p class="lead">{t('contact.lead')}</p>
  </section>

  <div class="cgrid">
  <div class="hcol">
  <Divider title={t('common.message')} index="01" />
  <ContactForm {prefix} {state} />
  </div>
  <div class="hcol">
  <Divider title={t('common.company')} index="02" />
  <section class="company">
    <article class="card coc" id="company">
      <h2>{COMPANY.name}</h2>
      <dl><CompanyRows company={COMPANY} seat={seatHtml(t('common.country'), locale)} iban={ibanPrinted()} {labels} /><div class="crow"><dt class="lb">{t('contact.brands')}</dt><dd class="br">{#each BRANDS as brand (brand.id)}<a class="ln" href={brand.url} target="_blank" rel="noopener">{brand.domain}<span class="arr ext" aria-hidden="true">{@html EXT}</span><span class="sr">{t('common.opens_in_a_new_tab')}</span></a>{/each}</dd></div></dl>
      <p class="cnote" id="cnote" aria-live="polite"></p>
    </article>
  </section>
  {@html script(COPY, { COPIED: t('form.copied'), NOTE: t('form.copied_note', { what: '%s' }), COPY: t('contact.copy') })}
  </div>
  <HatchPills id="hb" box={[500, 440]} pills={[[0, 40, 330], [160, 0, 440], [320, 70, 400]]} class="hx-bot" />
  </div>

</Shell>
