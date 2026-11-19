<script lang="ts">
  import { ARROW } from '@gaw/ui/icons.ts';
  import Shell from '#lib/Shell.svelte';
  import { get } from '#lib/translations/index.ts';
  import { localeOf, pathOf, prefixOf } from '@gaw/i18n/locale.ts';
  import { page } from '$app/state';
  import { faqFor } from '#lib/cms.ts';

  const i18n = get();
  const t = i18n.t;
  const locale = $derived(localeOf(page.url.pathname));
  const prefix = $derived(prefixOf(locale));
  const href = (route: string) => pathOf(route, locale);
  const faq = $derived(faqFor(page.data.cms, 'midi-control', locale, t as unknown as (key: string) => string));
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
  <article class="card qa">
    {#each faq as group, g}<div class="qg"><h3>{group.title}</h3><div class="ql">{#each group.items as item, i}<details open={g === 0 && i === 0}><summary><span>{item.question}</span></summary><p>{item.answer}</p></details>{/each}</div></div>{/each}
  </article>

  <div class="divider"><h2>{t('midisupport.still_stuck')}</h2><i class="ticks"></i><span class="idx">03</span></div>
  <section class="faq">
    <p>{@html t('midisupport.use_the_contact_form_or', { p: prefix })}</p>
    <div class="links"><a class="ln" href={href('/apps/midi-control')}>{t('common.midi_control_for_fireface')}</a></div>
  </section>

</Shell>
