<script lang="ts">
  import { ARROW } from '@gaw/ui/icons.ts';
  import Shell from '#lib/Shell.svelte';
  import { get } from '#lib/translations/index.ts';
  import { localeOf, pathOf, prefixOf } from '@gaw/i18n/locale.ts';
  import { page } from '$app/state';

  const i18n = get();
  const t = i18n.t;
  const locale = $derived(localeOf(page.url.pathname));
  const prefix = $derived(prefixOf(locale));
  const href = (route: string) => pathOf(route, locale);
</script>

<Shell name="midi-support" title={t('midisupport.support_midi_control_for_fireface')}>

  <section class="shead">
    <div class="crumb">{@html t('midisupport.apps_midi_control_support', { p: prefix })}</div>
    <h1>{@html t('midisupport.support_for_fireface')}</h1>
    <p class="lead">{t('midisupport.answers_for_midi_control_for')}</p>
  </section>

  <div class="divider"><h2>{t('midisupport.get_in_touch')}</h2><i class="ticks"></i><span class="idx">01</span></div>
  <section class="touch">
    <article class="card">
      <div class="scene"><ul class="hmenu" aria-hidden="true"><li>{t('midisupport.support')}</li><li class="on">{t('midisupport.report_a_problem')}</li><li class="sep"></li><li>{@html t('midisupport.logs_l')}</li></ul></div><div class="fade"></div>
      <div class="content">
        <h2>{t('midisupport.report_a_problem_2')}</h2>
        <p>{t('midisupport.in_the_app_choose_help')}</p>
        <p class="hint">{t('midisupport.help_logs_l_shows_the')}</p>
      </div>
    </article>
    <article class="card">
      <div class="scene"><svg class="envl" viewBox="0 0 72 72" aria-hidden="true"><rect x="6" y="16" width="60" height="42" rx="7" fill="none" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--dim)"/><path d="M8 20 L36 41 L64 20" fill="none" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" style="stroke:url(#xg)"/></svg></div><div class="fade"></div>
      <div class="content">
        <h2>{t('midisupport.write_to_us')}</h2>
        <p>{t('midisupport.questions_about_purchase_the_trial')}</p>
        <p class="go"><a class="ln" href={href('/support') + '?product=midi-control#contact'}>{@html t('midisupport.contact_form', { arrow: ARROW })}</a></p>
      </div>
    </article>
  </section>

  <div class="divider"><h2>{t('common.faq')}</h2><i class="ticks"></i><span class="idx">02</span></div>
  <article class="card qa"><div class="qg"><h3>{t('midisupport.getting_started')}</h3><div class="ql"><details open><summary><span>{t('midisupport.do_i_need_firewire_or')}</span></summary><p>{t('midisupport.no_the_app_talks_to')}</p></details><details><summary><span>{t('midisupport.do_i_have_to_enable')}</span></summary><p>{t('midisupport.no_the_units_stand_alone')}</p></details><details><summary><span>{t('midisupport.which_midi_interface_do_i')}</span></summary><p>{t('midisupport.any_usb_midi_interface_with')}</p></details><details><summary><span>{t('midisupport.which_macs_and_macos_versions')}</span></summary><p>{t('midisupport.macos_13_ventura_to_macos')}</p></details><details><summary><span>{t('midisupport.does_it_support_the_fireface')}</span></summary><p>{t('midisupport.the_fireface_800_is_supported')}</p></details></div></div><div class="qg"><h3>{t('midisupport.using_the_app')}</h3><div class="ql"><details><summary><span>{t('midisupport.why_cant_i_find_eq')}</span></summary><p>{t('midisupport.the_fireface_800s_stand_alone')}</p></details><details><summary><span>{t('midisupport.why_does_the_app_not')}</span></summary><p>{t('midisupport.the_front_panel_sends_nothing')}</p></details><details><summary><span>{t('midisupport.why_does_the_app_ask')}</span></summary><p>{t('midisupport.the_unit_never_reports_phantom')}</p></details><details><summary><span>{t('midisupport.what_happens_when_i_switch')}</span></summary><p>{t('midisupport.the_unit_reloads_its_stored')}</p></details><details><summary><span>{t('midisupport.can_i_use_more_than')}</span></summary><p>{t('midisupport.yes_each_unit_is_a')}</p></details></div></div><div class="qg"><h3>{@html t('midisupport.trial_purchase')}</h3><div class="ql"><details><summary><span>{t('midisupport.how_does_the_trial_work')}</span></summary><p>{t('midisupport.download_the_app_from_the')}</p></details><details><summary><span>{t('midisupport.what_happens_after_the_trial')}</span></summary><p>{t('midisupport.the_app_is_a_one')}</p></details><details><summary><span>{t('midisupport.i_bought_it_on_another')}</span></summary><p>{t('midisupport.choose_restore_purchases_in_the')}</p></details></div></div></article>

  <div class="divider"><h2>{t('midisupport.still_stuck')}</h2><i class="ticks"></i><span class="idx">03</span></div>
  <section class="faq">
    <p>{@html t('midisupport.use_the_contact_form_or', { p: prefix })}</p>
    <div class="links"><a class="ln" href={href('/apps/midi-control')}>{t('common.midi_control_for_fireface')}</a></div>
  </section>

</Shell>
