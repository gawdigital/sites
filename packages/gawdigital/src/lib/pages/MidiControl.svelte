<script lang="ts">
  import art_midi_control_appwin_aw_d from '#lib/art/midi-control-appwin-aw-d.svg?raw';
  import art_midi_control_appwin_aw_d_2 from '#lib/art/midi-control-appwin-aw-d-2.svg?raw';
  import art_midi_control_appwin_aw_d_3 from '#lib/art/midi-control-appwin-aw-d-3.svg?raw';
  import art_midi_control_appwin_aw_d_4 from '#lib/art/midi-control-appwin-aw-d-4.svg?raw';
  import art_midi_control_appwin_aw_l from '#lib/art/midi-control-appwin-aw-l.svg?raw';
  import art_midi_control_appwin_aw_l_2 from '#lib/art/midi-control-appwin-aw-l-2.svg?raw';
  import art_midi_control_appwin_aw_l_3 from '#lib/art/midi-control-appwin-aw-l-3.svg?raw';
  import art_midi_control_appwin_aw_l_4 from '#lib/art/midi-control-appwin-aw-l-4.svg?raw';
  import art_midi_control_art from '#lib/art/midi-control-art.svg?raw';
  import art_midi_control_art_2 from '#lib/art/midi-control-art-2.svg?raw';
  import art_midi_control_bank from '#lib/art/midi-control-bank.svg?raw';
  import { BLOB_PATH, EXT } from '@gaw/ui/icons.ts';
  import Shell from '#lib/Shell.svelte';
  import { get } from '#lib/translations/index.ts';
  import { localeOf, pathOf, prefixOf } from '@gaw/i18n/locale.ts';
  import { page } from '$app/state';

  const i18n = get();
  const t = i18n.t;
  const locale = $derived(localeOf(page.url.pathname));
  const prefix = $derived(prefixOf(locale));
  const href = (route: string) => pathOf(route, locale);
  const art: Record<string, string> = { 'midi-control-appwin-aw-d': art_midi_control_appwin_aw_d, 'midi-control-appwin-aw-d-2': art_midi_control_appwin_aw_d_2, 'midi-control-appwin-aw-d-3': art_midi_control_appwin_aw_d_3, 'midi-control-appwin-aw-d-4': art_midi_control_appwin_aw_d_4, 'midi-control-appwin-aw-l': art_midi_control_appwin_aw_l, 'midi-control-appwin-aw-l-2': art_midi_control_appwin_aw_l_2, 'midi-control-appwin-aw-l-3': art_midi_control_appwin_aw_l_3, 'midi-control-appwin-aw-l-4': art_midi_control_appwin_aw_l_4, 'midi-control-art': art_midi_control_art, 'midi-control-art-2': art_midi_control_art_2, 'midi-control-bank': art_midi_control_bank };
</script>

<Shell name="midi-control" title={t('common.midi_control_for_fireface')}>
  {#snippet before()}<svg class="blob b2" viewBox="0 0 1680 2207" preserveAspectRatio="none"><path style="fill:var(--blob)" d={BLOB_PATH}/></svg>{/snippet}

  <section class="mhead m4 m5 m5b"><div class="mt"><div class="crumb">{@html t('midi.apps_midi_control', { p: prefix })}</div><h1>{@html t('midi.midi_control_for_fireface')}</h1><p class="lead">{t('midi.control_the_fireface_800s_stand')}</p><div class="store"><a class="asb" href="#app-store" target="_blank" rel="noopener" aria-label={t('midi.download_on_the_mac_app')}><img class="asb-w" src="/badges/mac-app-store-white.svg" alt={t('midi.download_on_the_mac_app_2')}><img class="asb-b" src="/badges/mac-app-store-black.svg" alt=""></a></div></div><div class="mwin" aria-hidden="true">{@html art['midi-control-appwin-aw-d']}{@html art['midi-control-appwin-aw-l']}</div></section>

  <article class="card wide" style="margin-top:100px">
    <div class="scene"></div><div class="fade"></div>
    <div class="content">
      <div class="cwin">{@html art['midi-control-appwin-aw-d-2']}{@html art['midi-control-appwin-aw-l-2']}</div><div class="ident"><span class="ipic"><svg viewBox="0 0 1254 1254" role="img" aria-label="MIDI Control for Fireface"><use href="#appicon"/></svg></span><span class="itx"><b>{t('common.midi_control_for_fireface')}</b><span>{t('midi.for_the_fireface_800_macos')}</span></span></div>
      <dl class="spec">
        <div><dt>{t('midi.platform')}</dt><dd>{@html t('midi.macos_13_ventura_to_golden')}</dd></div>
        <div><dt>{t('midi.device')}</dt><dd>{@html t('midi.fireface_800_fireface_400_planned')}</dd></div>
        <div class="hl"><dt>{t('midi.trial')}</dt><dd class="x">{@html t('midi.14_days_free_every_feature')}</dd></div>
        <div><dt>{t('midi.store')}</dt><dd>{@html t('midi.mac_app_store_free_download')}</dd></div>
      </dl>
    </div>
  </article>

  <div class="divider"><h2>{t('midi.features')}</h2><i class="ticks"></i><span class="idx">01</span></div>
  <section class="feat">
    <article class="card big">
      <div class="scene sd"><div class="bankwrap">{@html art['midi-control-bank']}</div></div><div class="fade"></div>
      <div class="content">
        <span class="tag">{t('midi.every_submix')}</span>
        <h2>{@html t('midi.faders_sends')}</h2>
        <p>{t('midi.set_every_send_into_every')}</p>
      </div>
    </article>
    <div class="tiles"><article class="tile"><svg viewBox="0 0 72 72"><circle cx="36" cy="38" r="22" fill="none" style="stroke:var(--t1)" stroke-width="5"/><path d="M36 38 L22 22" style="stroke:url(#xg)" stroke-width="5" stroke-linecap="round"/><text x="6" y="70" font-size="13" font-weight="800" style="fill:var(--dim)">L</text><text x="58" y="70" font-size="13" font-weight="800" style="fill:var(--dim)">R</text></svg><h3>{t('midi.pan')}</h3><p>{t('midi.place_every_input_in_each')}</p></article><article class="tile"><svg viewBox="0 0 72 72"><rect x="4" y="18" width="64" height="36" rx="18" style="fill:var(--mute)"/><text x="36" y="42" font-size="15" font-weight="800" fill="#fff" text-anchor="middle">MUTE</text></svg><h3>{t('midi.mute')}</h3><p>{t('midi.silence_an_input_across_every')}</p></article><article class="tile"><svg viewBox="0 0 72 72"><rect x="4" y="18" width="64" height="36" rx="18" fill="none" style="stroke:url(#xg)" stroke-width="4"/><text x="36" y="42" font-size="16" font-weight="800" style="fill:url(#xg)" text-anchor="middle">48V</text></svg><h3>{t('midi.48_v')}</h3><p>{t('midi.phantom_power_for_mic_7')}</p></article><article class="tile"><svg viewBox="0 0 72 72"><rect x="4" y="8" width="52" height="16" rx="8" style="fill:var(--t1)"/><rect x="12" y="28" width="56" height="16" rx="8" style="fill:url(#xg)"/><rect x="4" y="48" width="44" height="16" rx="8" style="fill:var(--t1)"/></svg><h3>{t('midi.snapshots')}</h3><p>{t('midi.save_named_mixes_and_recall')}</p></article><article class="tile">{@html art['midi-control-art']}<h3>{t('midi.monitor_dim_mute')}</h3><p>{t('midi.dim_or_mute_the_monitor')}</p></article><article class="tile">{@html art['midi-control-art-2']}<h3>{t('midi.several_units')}</h3><p>{t('midi.run_more_than_one_fireface')}</p></article></div>
  </section>

  <div class="divider"><h2>{t('midi.in_the_app')}</h2><i class="ticks"></i><span class="idx">02</span></div>
  <section class="inapp">
    <article class="card wincard">
      <div class="scene"></div>
      <div class="win">{@html art['midi-control-appwin-aw-d-3']}{@html art['midi-control-appwin-aw-l-3']}</div>
      <div class="content">
        <span class="tag">{t('midi.snapshot_drawer')}</span>
        <h2>{@html t('midi.every_mix_you_saved')}</h2>
        <p>{t('midi.newest_first_or_by_name')}</p>
      </div>
    </article>
    <article class="card wincard">
      <div class="scene"></div>
      <div class="win">{@html art['midi-control-appwin-aw-d-4']}{@html art['midi-control-appwin-aw-l-4']}</div>
      <div class="content">
        <span class="tag">{t('midi.setup')}</span>
        <h2>{@html t('midi.power_on_clock')}</h2>
        <p>{t('midi.state_what_48_v_and')}</p>
      </div>
    </article>
  </section>

  <div class="divider"><h2>{t('midi.compatibility')}</h2><i class="ticks"></i><span class="idx">03</span></div>
  <article class="card compat">
    <div class="scene"></div>
    <div class="content">
      <h2>{@html t('midi.no_firewire_just_midi')}</h2>
      <p class="note">{t('midi.the_app_talks_to_the')}</p>
    </div>
    <ul class="list">
      <li><span>{@html t('midi.fireface_800_stand_alone_mode')}</span><span class="pill ok">{t('midi.supported')}</span></li>
      <li><span>{@html t('midi.fireface_400_same_scheme_fewer')}</span><span class="pill plan">{t('midi.planned')}</span></li>
      <li><span>{@html t('midi.macos_13_to_macos_27')}</span><span class="pill ok">{t('midi.supported')}</span></li>
      <li><span>{@html t('midi.midi_interface_any_usb_midi')}</span><span class="pill need">{t('midi.required')}</span></li>
    </ul>
  </article>

  <div class="divider"><h2>{t('midi.get_started')}</h2><i class="ticks"></i><span class="idx">04</span></div>
  <section class="start">
    <article class="card how">
      <div class="scene sd"><div class="din"><b class="cord"></b><div class="plug"><b class="notch"></b><i style="--a:-90deg"></i><i style="--a:-45deg"></i><i style="--a:0deg"></i><i style="--a:45deg"></i><i style="--a:90deg"></i></div></div></div><div class="fade"></div>
      <div class="content">
        <h2>{t('midi.how_it_works')}</h2>
        <ol class="steps"><li><span class="num">1</span><span>{@html t('midi.download_the_app_from_the', { ext: EXT })}</span></li><li><span class="num">2</span><span>{t('midi.connect_your_fireface_800_over')}</span></li><li><span class="num">3</span><span>{t('midi.start_your_14_day_free')}</span></li></ol>
        <p class="after">{@html t('midi.stuck_visit_our_faq_or', { p: prefix })}</p>
      </div>
    </article>
    <div class="r">
      <article class="card trial">
        <div class="scene se"><div class="days"><span class="big">14</span><div class="dots"><i class="lit"></i><i class="lit"></i><i class="lit"></i><i class=""></i><i class=""></i><i class=""></i><i class=""></i><i class=""></i><i class=""></i><i class=""></i><i class=""></i><i class=""></i><i class=""></i><i class=""></i></div></div></div><div class="fade"></div>
        <div class="content">
          <h2>{@html t('midi.14_days_free_every_feature_2')}</h2>
          <p>{t('midi.download_the_app_and_start')}</p>
          <div class="row"><a class="btn mint" href="#app-store" target="_blank" rel="noopener">{@html t('midi.download_opens_in_a_new', { ext: EXT })}</a></div>
        </div>
      </article>
    </div>
  </section>

  <div class="divider"><h2>{t('midi.help')}</h2><i class="ticks"></i><span class="idx">05</span></div>
  <section class="faq">
    <p>{t('midi.in_the_app_help_report')}</p>
    <div class="links"><a class="ln" href={href('/apps/midi-control/support')}>{t('common.faq')}</a><a class="ln" href={href('/apps/midi-control/support')}>{t('midi.support')}</a><a class="ln" href={href('/privacy')}>{t('midi.privacy')}</a></div>
  </section>

</Shell>
