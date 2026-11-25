<script lang="ts">
  import { BRANDS } from '@gaw/company/brands.ts';
  import { localeOf, pathOf } from '@gaw/i18n/locale.ts';
  import BrandCard from '@gaw/ui/BrandCard.svelte';
  import Divider from '@gaw/ui/Divider.svelte';
  import HatchPills from '@gaw/ui/HatchPills.svelte';
  import { ARROW } from '@gaw/ui/icons.ts';
  import { page } from '$app/state';

  import badgeDigital from '#lib/art/badge-digital.svg?raw';
  import badgeStudio from '#lib/art/badge-studio.svg?raw';
  import appwin from '#lib/art/digital-appwin.svg?raw';
  import studio from '#lib/art/studio.jpg';
  import Shell from '#lib/Shell.svelte';
  import { get } from '#lib/translations/index.ts';

  const { t } = get();
  const locale = $derived(localeOf(page.url.pathname));
  const contact = $derived(pathOf('/contact', locale));
  const external = $derived(t('common.opens_in_a_new_tab'));
  const [digital, studioBrand] = BRANDS;
  // What each part of the group does: the brands' tags, and the same again as the lines of "Who we are".
  const crafts = $derived({
    digital: [t('home.apps'), t('home.games'), t('home.web')],
    studio: [t('home.recording'), t('home.mix'), t('home.mastering')],
  });
  const topics = ['digital', 'studio', 'general'] as const;
</script>

<Shell name="home" title={t('home.page_title')}>

  <section class="ghero">
    <HatchPills id="he" bold width={80} box={[760, 1300]} pills={[[380, 190, 430], [520, 80, 540], [660, 160, 460]]} class="eq" />
    <div class="kicker">{t('common.group')}</div>
    <!-- The Czech claim (`home/cs.json`, "Hraj a bude ti hráno.") is provisional: still open in issue #22. -->
    <h1>{@html t('home.claim')}</h1>
    <p class="lead">{t('home.lead')}</p>
    <div class="cta"><a class="btn" href="#brands">{t('home.our_brands')}<span class="arr down" aria-hidden="true">{@html ARROW}</span></a><a class="btn ghost" href={contact}>{t('home.get_in_touch')}</a></div>
  </section>

  <Divider title={t('home.our_brands')} index="01" />
  <section class="brands" id="brands">
  <div class="bcol">
    <HatchPills id="hm1" width={48} box={[218, 220]} pills={[[0, 32, 143], [85, 0, 220], [170, 21, 220]]} class="hm over-m" />
    <BrandCard brand={digital} badge={badgeDigital} tags={crafts.digital} text={t('home.digital_text')} visit={t('home.visit')} {external}><div class="art">{@html appwin}</div></BrandCard>
    <Divider title={t('home.who_we_are')} index="02" class="col-h l-who" />
    <article class="who tl">
      <h3 class="big">{@html t('home.one_group_many_crafts')}</h3>
      <p>{t('home.who_text')}</p>
      <ul><li>{t('chrome.digital')}<span>{t('home.digital_crafts')}</span></li><li>{t('chrome.studio')}<span>{t('home.studio_crafts')}</span></li><li>{t('home.group')}<span>{t('home.group_crafts')}</span></li></ul>
    </article>
    <HatchPills id="hu" box={[560, 620]} pills={[[30, 100, 540], [190, 130, 610], [350, 40, 580]]} class="under" />
  </div>
  <div class="bcol c2">
    <HatchPills id="ho" box={[630, 416]} pills={[[90, 60, 270], [250, 0, 416], [410, 40, 416]]} class="over" />
    <BrandCard brand={studioBrand} badge={badgeStudio} tags={crafts.studio} text={t('home.studio_text')} visit={t('home.visit')} {external}><div class="art" style="background-image:url({studio})"></div></BrandCard>
    <HatchPills id="hm2" width={48} box={[218, 455]} pills={[[0, 15, 405], [85, 0, 455], [170, 25, 425]]} class="hm under-m" />
    <Divider title={t('home.get_in_touch')} index="03" class="col-h l-touch" />
    <!-- A plain GET form: the chosen topic travels in the address, and the contact form's script selects it. -->
    <form class="touch tl" method="get" action={contact}>
      <h3 class="big">{@html t('home.lets_make_something')}</h3>
      <p>{t('home.touch_text')}</p>
      <div class="side"><fieldset><legend>{t('common.topic')}</legend><div class="topics">{#each topics as topic, i (topic)}<label><input type="radio" name="topic" value={topic} checked={i === 0}><span>{t(`common.${topic}`)}</span></label>{/each}</div></fieldset>
        <button class="btn" type="submit">{t('home.write_to_us')}<span class="arr" aria-hidden="true">{@html ARROW}</span></button></div>
    </form>
    <HatchPills id="hm3" width={48} box={[218, 265]} pills={[[0, 40, 240], [85, 0, 265], [170, 60, 250]]} class="hm last-m" />
  </div>
  </section>

</Shell>
