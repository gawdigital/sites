<script lang="ts">
  import art_home_appwin_aw_d from '#lib/art/home-appwin-aw-d.svg?raw';
  import art_home_appwin_aw_d_2 from '#lib/art/home-appwin-aw-d-2.svg?raw';
  import art_home_appwin_aw_l from '#lib/art/home-appwin-aw-l.svg?raw';
  import art_home_appwin_aw_l_2 from '#lib/art/home-appwin-aw-l-2.svg?raw';
  import art_home_pix from '#lib/art/home-pix.svg?raw';
  import Shell from '#lib/Shell.svelte';
  import { get } from '#lib/translations/index.ts';
  import { localeOf, pathOf } from '@gaw/i18n/locale.ts';
  import { page } from '$app/state';
  import { productFor } from '#lib/cms.ts';

  const i18n = get();
  const t = i18n.t;
  const locale = $derived(localeOf(page.url.pathname));
  const href = (route: string) => pathOf(route, locale);
  const games = $derived(productFor(page.data.cms, 'games', locale, t as unknown as (key: string) => string));
  const art: Record<string, string> = { 'home-appwin-aw-d': art_home_appwin_aw_d, 'home-appwin-aw-d-2': art_home_appwin_aw_d_2, 'home-appwin-aw-l': art_home_appwin_aw_l, 'home-appwin-aw-l-2': art_home_appwin_aw_l_2, 'home-pix': art_home_pix };
</script>

<Shell name="home" title={t('common.g_a_w_digital')}>

  <section class="hero peek-hero">
    <div class="txt">
      <div class="kicker">{t('common.g_a_w_digital')}</div>
      <h1>{@html t('home.apps_games_web')}</h1>
      <p class="lead">{t('home.g_a_w_digital_is')}</p>
      <div class="jump"><a href={href('/apps/midi-control')}>{@html t('home.01_apps')}</a><!-- svelte-ignore a11y_missing_attribute (GAMES has no page yet) --><a>{@html t('home.02_games')}</a><a href={href('/web')}>{@html t('home.03_web')}</a></div>
    </div>
    <div class="peek" aria-hidden="true"><div class="tilt">{@html art['home-appwin-aw-d']}{@html art['home-appwin-aw-l']}</div></div>
  </section>

  <div class="divider"><h2>{t('home.what_we_make')}</h2><i class="ticks"></i><span class="idx">01</span></div>
  <article class="card appcard">
    <div class="scene"></div><div class="fade"></div>
    <div class="content">
      <span class="tag mac">{t('home.mac_app')}</span>
      <h2>{t('home.apps')}</h2>
      <p>{t('home.midi_control_for_fireface_a')}</p>
      <div class="app"><span class="ic"><svg viewBox="0 0 1254 1254" role="img" aria-label="MIDI Control for Fireface"><use href="#appicon"/></svg></span><span><b>{t('common.midi_control_for_fireface')}</b>
        <small>{t('home.fireface_800_macos_13')}</small></span></div>
      <div class="row"><a class="btn" href={href('/apps/midi-control')}>{t('home.view_app')}</a></div>
    </div>
    <div class="shot">{@html art['home-appwin-aw-d-2']}{@html art['home-appwin-aw-l-2']}</div>
  </article>
  <section class="duo">
    <article class="card games">
      <div class="scene sb"><div class="pixwrap">{@html art['home-pix']}</div></div><div class="fade"></div>
      <div class="content">
        <span class="tag">{t('common.coming_soon')}</span>
        <h2>{games.name}</h2>
        <p>{games.summary}</p>
      </div>
    </article>
    <article class="card web">
      <div class="scene sd" aria-hidden="true">
        <div class="code"><div class="bar"><i></i><i></i><i></i><span>en.json</span></div><pre><span class="p">"inbox"</span>: <span class="s">"You have <b>{'{{'}count:number;{'}}'}</b> <b>{'{{'}count:plural; one:message; other:messages;{'}}'}</b>."</span></pre><div class="out"><span class="c">{'{'} count: 1234 {'}'} →</span> You have 1,234 messages.</div></div>
      </div><div class="fade"></div>
      <div class="content">
        <span class="tag">{t('home.web_tag')}</span>
        <h2>{t('home.web')}</h2>
        <p>{t('home.web_text')}</p>
        <div class="row"><a class="btn" href={href('/web')}>{t('home.view_projects')}</a></div>
      </div>
    </article>
  </section>

  <section class="help">
    <div><h2>{t('common.support')}</h2><p>{t('home.faq_and_report_a_problem')}</p></div>
    <div class="row"><span class="links"><a class="ln" href={href('/apps/midi-control/support')}>{t('common.faq')}</a></span><a class="btn" href={href('/support')}>{t('home.get_help')}</a></div>
  </section>

</Shell>
