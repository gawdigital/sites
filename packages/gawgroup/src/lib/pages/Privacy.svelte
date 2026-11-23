<script lang="ts">
  import { BRANDS } from '@gaw/company/brands.ts';
  import { COMPANY, seatHtml } from '@gaw/company/company.ts';
  import { localeOf, prefixOf } from '@gaw/i18n/locale.ts';
  import Divider from '@gaw/ui/Divider.svelte';
  import HatchPills from '@gaw/ui/HatchPills.svelte';
  import { EXT } from '@gaw/ui/icons.ts';
  import { page } from '$app/state';

  import { place, type Pill } from '#lib/hatch.ts';
  import Shell from '#lib/Shell.svelte';
  import { get } from '#lib/translations/index.ts';

  const { t } = get();
  const locale = $derived(localeOf(page.url.pathname));
  const prefix = $derived(prefixOf(locale));
  // A brand's site as a link in a sentence.
  const link = ({ domain, url }: (typeof BRANDS)[number]) =>
    `<a class="ln" href="${url}" target="_blank" rel="noopener">${domain}<span class="arr ext" aria-hidden="true">${EXT}</span><span class="sr">${t('common.opens_in_a_new_tab')}</span></a>`;
  const [digital, studio] = BRANDS;

  // The phone's hatches, in the frame's coordinates. The desktop's hang from the cards (`.hdc`, in pages.css).
  const PHONE: Pill[][] = [
    [[282, 170, 272], [342, 128, 252]],
    [[215, 800, 940], [300, 780, 1000]],
    [[265, 1520, 1650], [350, 1490, 1720]],
    [[-20, 2150, 2255], [65, 2130, 2250]],
    [[285, 3400, 3600], [370, 3430, 3560]],
    [[200, 4020, 4170], [285, 4000, 4230], [370, 4040, 4140]],
    [[-20, 4790, 4925], [65, 4820, 4915]],
  ];
  const phone = PHONE.map((pills) => place(pills, 48));
</script>

<Shell name="privacy" title={t('privacy.page_title')}>
  {#snippet before()}{#each phone as group, i (i)}<HatchPills id="hc{i}" width={48} pills={group.pills} class="hmc" style={group.style} />{/each}{/snippet}

  <section class="shead">
    <HatchPills id="ht" box={[500, 470]} pills={[[0, 60, 340], [160, 0, 470], [320, 180, 360]]} class="hx-top" />
    <div class="kicker">{t('common.group')}</div>
    <h1>{t('privacy.privacy')}</h1>
    <p class="lead">{t('privacy.what_we_collect_when_you')}</p>
    <p class="upd">{t('privacy.last_updated')}</p>
  </section>

  <div class="pgrid"><div class="hcol full"><Divider title={t('privacy.at_a_glance')} index="01" /><article class="card coc pc"><div class="gl"><div><span class="lb">{t('privacy.what_we_get')}</span><p>{t('privacy.only_what_you_type_into')}</p></div><div><span class="lb">{t('privacy.stored_on_this_site')}</span><p>{t('privacy.nothing_your_message_goes_straight')}</p></div><div><span class="lb">{t('privacy.tracking')}</span><p>{t('privacy.none_no_analytics_no_advertising')}</p></div><div><span class="lb">{t('privacy.your_rights')}</span><p>{@html t('privacy.see_correct_or_delete_your', { p: prefix })}</p></div></div></article><HatchPills id="hd0" box={[410, 390]} pills={[[0, 40, 290], [160, 0, 390], [320, 60, 320]]} class="hdc d0" /></div></div>
  <div class="pgrid"><div class="hcol"><Divider title={t('privacy.who_we_are')} index="02" /><article class="card coc pc"><div class="pbody"><p>{t('privacy.this_site_is_run_by')}</p><dl class="pdl"><div class="crow"><dt class="lb">{t('common.company')}</dt><dd>{COMPANY.name}</dd></div><div class="crow"><dt class="lb">{t('common.address')}</dt><dd>{@html seatHtml(t('common.country'), locale)}</dd></div><div class="crow"><dt class="lb">{t('common.company_id_label')}</dt><dd>{COMPANY.ico}</dd></div><div class="crow"><dt class="lb">{t('common.register')}</dt><dd>{t('common.registered', { file: COMPANY.registerFile })}</dd></div><div class="crow"><dt class="lb">{t('common.contact')}</dt><dd>{@html t('privacy.the_contact_form_or_a', { p: prefix })}</dd></div></dl></div></article></div><div class="hcol"><Divider title={t('privacy.what_we_collect')} index="03" /><article class="card coc pc"><div class="pbody"><dl class="pdl"><div class="crow"><dt class="lb">{t('privacy.contact_form')}</dt><dd>{t('privacy.your_email_address_the_topic')}</dd></div><div class="crow"><dt class="lb">{t('common.verification')}</dt><dd>{t('privacy.cloudflare_turnstile_checks_that_a')}</dd></div><div class="crow"><dt class="lb">{t('privacy.visiting_the_site')}</dt><dd>{t('privacy.our_host_cloudflare_processes_your')}</dd></div><div class="crow"><dt class="lb">{t('privacy.our_brands')}</dt><dd>{@html t('privacy.the_brands_have_their_own', { digital: link(digital), studio: link(studio) })}</dd></div></dl></div></article><HatchPills id="hd1" box={[410, 370]} pills={[[0, 40, 290], [160, 0, 370], [320, 60, 310]]} class="hdc d1" /></div></div>
  <div class="pgrid"><div class="hcol"><Divider title={t('privacy.why_legal_basis')} index="04" /><article class="card coc pc"><div class="pbody"><p>{@html t('privacy.we_rely_on_our_legitimate')}</p><dl class="pdl"><div class="crow"><dt class="lb">{t('privacy.answering_you')}</dt><dd>{t('privacy.replying_to_the_people_who')}</dd></div><div class="crow"><dt class="lb">{t('privacy.spam_protection')}</dt><dd>{t('privacy.keeping_the_form_free_of')}</dd></div><div class="crow"><dt class="lb">{t('privacy.running_the_site')}</dt><dd>{t('privacy.delivering_the_pages_securely')}</dd></div></dl><p>{t('privacy.you_can_object_to_this')}</p></div></article><HatchPills id="hd2" box={[410, 370]} pills={[[0, 40, 220], [160, 0, 300], [320, 40, 370]]} class="hdc d2" /></div><div class="hcol"><Divider title={t('privacy.who_processes_it')} index="05" /><article class="card coc pc"><div class="pbody"><dl class="pdl"><div class="crow"><dt class="lb">{t('privacy.cloudflare')}</dt><dd>{t('privacy.hosts_this_site_on_cloudflare')}</dd></div><div class="crow"><dt class="lb">{t('privacy.blueboard')}</dt><dd>{t('privacy.hosts_our_mailbox_where')}</dd></div></dl><p>{t('privacy.both_process_the_data_on')}</p><p>{@html t('privacy.cloudflare_also_uses_turnstiles_signals', { ext: EXT })}</p></div></article></div></div>
  <div class="pgrid"><div class="hcol"><Divider title={t('privacy.cookies_storage')} index="06" /><article class="card coc pc"><div class="pbody"><dl class="pdl"><div class="crow"><dt class="lb">{t('privacy.cookies')}</dt><dd>{t('privacy.no_analytics_advertising_or_tracking')}</dd></div><div class="crow"><dt class="lb">{t('privacy.local_storage')}</dt><dd>{@html t('privacy.one_item_theme_keeps_your')}</dd></div><div class="crow"><dt class="lb">{t('privacy.language')}</dt><dd>{@html t('privacy.one_item_lang_keeps_the')}</dd></div><div class="crow"><dt class="lb">{t('privacy.how_long')}</dt><dd>{t('privacy.this_site_stores_nothing_the')} {@html t('privacy.in_our_mailbox_we')}</dd></div></dl></div></article></div><div class="hcol"><Divider title={t('privacy.your_rights')} index="07" /><article class="card coc pc"><div class="pbody"><dl class="pdl"><div class="crow"><dt class="lb">{t('privacy.access')}</dt><dd>{@html t('privacy.ask_what_data_we_hold')}</dd></div><div class="crow"><dt class="lb">{t('privacy.rectification')}</dt><dd>{@html t('privacy.have_wrong_data_corrected_art')}</dd></div><div class="crow"><dt class="lb">{t('privacy.erasure')}</dt><dd>{@html t('privacy.have_your_data_deleted_art')}</dd></div><div class="crow"><dt class="lb">{t('privacy.restriction')}</dt><dd>{@html t('privacy.have_its_use_limited_for')}</dd></div><div class="crow"><dt class="lb">{t('privacy.objection')}</dt><dd>{@html t('privacy.object_to_processing_based_on')}</dd></div></dl><p>{@html t('privacy.use_the_contact_form_or', { p: prefix })}</p><p>{@html t('privacy.you_can_also_complain_to', { ext: EXT })}</p></div></article><HatchPills id="hd3" box={[410, 440]} pills={[[0, 20, 360], [160, 60, 440], [320, 0, 290]]} class="hdc d3" /></div></div>
  <div class="pgrid"><div class="hcol full"><Divider title={t('privacy.changes')} index="08" /><div class="pbody pend"><p>{t('privacy.if_we_change_how_we')}</p><p>{t('privacy.last_updated')}.</p></div></div></div>
</Shell>
