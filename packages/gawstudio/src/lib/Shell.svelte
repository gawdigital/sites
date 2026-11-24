<script lang="ts">
  // Every page's document: the background, the header with the badge and the menu, the page's two columns under
  // its claim, and the footer. Pages are prerendered without client-side rendering, so this is the whole of what
  // ships; the only scripts are the language ones every site has.
  import type { Snippet } from 'svelte';

  import Alternates from '@gaw/i18n/Alternates.svelte';
  import { DEFAULT_LOCALE, localeOf, pathOf, routeOf } from '@gaw/i18n/locale.ts';
  import { LANG, LANG_HEAD } from '@gaw/i18n/scripts.ts';
  import LangSwitch from '@gaw/ui/LangSwitch.svelte';
  import { CROSS, DOTS } from '@gaw/ui/icons.ts';
  import { MENU, SPECULATION, inline } from '@gaw/ui/scripts.ts';
  import type { LangLink } from '@gaw/ui/types.ts';
  import { page } from '$app/state';

  import cart from './art/cart.svg?raw';
  import logo from './art/logo.svg?raw';
  import shape from './art/shape.svg?raw';
  import user from './art/user.svg?raw';
  import { LAUNCHED, NAV, ORIGIN, PAGES, STUDIO, STYLES, accent, type PageName } from './site.ts';
  import { get } from './translations/index.ts';

  let {
    name,
    title,
    claim,
    tabs,
    left,
    right,
  }: {
    name: PageName;
    title: string;
    /** The page's claim, with its line breaks. */
    claim: string;
    /** A service's two pages under its claim: Info, and the way to book or order it. */
    tabs?: { info: PageName; action: PageName; label: string };
    left: Snippet;
    right: Snippet;
  } = $props();

  const { t } = get();
  const meta = $derived(PAGES[name]);
  const locale = $derived(localeOf(page.url.pathname));
  const route = $derived(routeOf(page.url.pathname, locale));
  const langs: LangLink[] = $derived(
    (['en', 'de', 'cs'] as const).map((code) => ({
      code,
      label: code.toUpperCase(),
      href: pathOf(route, code),
      current: code === locale,
    })),
  );
</script>

<svelte:head>
  <!-- Before anything renders: an English page sends a visitor who prefers German or Czech to that locale. -->
  {#if locale === DEFAULT_LOCALE}{@html inline(LANG_HEAD)}{/if}
  <title>{title}</title>
  {@html STYLES}
  {@html SPECULATION}
  {#if LAUNCHED && name !== 'error'}<Alternates origin={ORIGIN} route={meta.route} {locale} />{:else}<meta name="robots" content="noindex" />{/if}
</svelte:head>

<div class={['page', name]}>
  <div class="shape" aria-hidden="true">{@html shape.replace('<svg ', '<svg preserveAspectRatio="none" ')}</div>
  <header class="top wrap">
    <a class="logo" href={pathOf('/', locale)} aria-label="G.A.W.Studio">{@html logo}</a>
    <nav class="nav">
      {#each NAV as id (id)}<a href={pathOf(PAGES[id].route, locale)} aria-current={id === meta.nav ? 'page' : undefined}>{t(`chrome.${id}`)}</a>{/each}
      <!-- The cart and the account come with the orders (issue #29); until then they are only drawn. -->
      <span class="icons" aria-hidden="true"><span class="ico">{@html user}</span><span class="ico cart">{@html cart}<b>0</b></span></span>
    </nav>
    <!-- The phone's menu, as on the other sites: three dots open an overlay (`@gaw/ui/scripts/menu.js`). Without
         JavaScript the links above stay on the page instead (the `noscript` rule in `site.ts`). -->
    <button class="mnav" type="button" aria-label={t('chrome.menu')} aria-expanded="false" aria-controls="mmenu">{@html DOTS}</button>
    <div class="mmenu" id="mmenu" role="dialog" aria-modal="true" aria-label={t('chrome.menu')} hidden>
      <button class="mclose" type="button" aria-label={t('chrome.close_menu')}>{@html CROSS}</button>
      <nav><ul>{#each NAV as id (id)}<li><a href={pathOf(PAGES[id].route, locale)} aria-current={id === meta.nav ? 'page' : undefined}>{t(`chrome.${id}`)}</a></li>{/each}</ul></nav>
      <div class="mfoot"><LangSwitch {langs} /></div>
    </div>
  </header>
  <main class="cols wrap">
    <div class="head">
      <h1>{@html accent(claim)}</h1>
      {#if tabs}<div class="tabs">{#each [[tabs.info, t('common.info')], [tabs.action, tabs.label]] as const as [id, label] (id)}{#if id === name}<span class="tag cur" aria-current="page">{label}</span>{:else}<a class="tag" href={pathOf(PAGES[id].route, locale)}>{label}</a>{/if}{/each}</div>{/if}
    </div>
    <div class="col a">{@render left()}</div>
    <div class="col b">{@render right()}</div>
  </main>
  <footer class="foot wrap">
    <div class="fpanel">
      <div>
        <h3>{t('common.where')}</h3>
        <p>{STUDIO.street}<br />{STUDIO.city}<br />{t('common.country')}</p>
        <a href={STUDIO.map} target="_blank" rel="noopener">{t('common.view_map')}<span class="sr"> {t('common.opens_in_a_new_tab')}</span></a>
      </div>
      <nav aria-label={t('chrome.menu')}>
        <h3>{t('chrome.menu')}</h3>
        <ul>{#each NAV as id (id)}<li><a href={pathOf(PAGES[id].route, locale)} aria-current={id === meta.nav ? 'page' : undefined}>{t(`chrome.${id}`)}</a></li>{/each}</ul>
      </nav>
      <nav aria-label={t('chrome.languages')}>
        <h3>{t('chrome.languages')}</h3>
        <LangSwitch {langs} />
      </nav>
      <p class="copy">{t('chrome.copyright')}</p>
    </div>
  </footer>
</div>
{@html inline(LANG, MENU)}
