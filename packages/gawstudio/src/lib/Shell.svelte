<script lang="ts">
  // Every page's document: the background, the header with the badge and the menu, the page's two columns under
  // its claim, and the footer. Pages are prerendered without client-side rendering, so this is the whole of what
  // ships; the only scripts are the language ones every site has.
  import type { Snippet } from 'svelte';

  import Alternates from '@gaw/i18n/Alternates.svelte';
  import { DEFAULT_LOCALE, localeOf, pathOf, routeOf } from '@gaw/i18n/locale.ts';
  import { LANG, LANG_HEAD } from '@gaw/i18n/scripts.ts';
  import LangSwitch from '@gaw/ui/LangSwitch.svelte';
  import { SPECULATION, inline } from '@gaw/ui/scripts.ts';
  import type { LangLink } from '@gaw/ui/types.ts';
  import { page } from '$app/state';

  import cart from './art/cart.svg?raw';
  import logo from './art/logo.svg?raw';
  import shape from './art/shape.svg?raw';
  import user from './art/user.svg?raw';
  import { LAUNCHED, NAV, ORIGIN, PAGES, STYLES, type PageName } from './site.ts';
  import { get } from './translations/index.ts';

  let {
    name,
    title,
    claim,
    tabs = false,
    left,
    right,
  }: {
    name: PageName;
    title: string;
    /** The page's claim, with its line breaks. */
    claim: string;
    /** The Info · Book now pair under the claim of a service's page. */
    tabs?: boolean;
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
    <!-- The phone's menu: a checkbox and its label, so it opens without JavaScript. -->
    <input id="menu" type="checkbox" aria-label={t('chrome.menu')} /><label class="burger" for="menu" aria-hidden="true"><i></i></label>
    <nav class="nav">
      {#each NAV as id (id)}<a href={pathOf(PAGES[id].route, locale)} aria-current={id === meta.nav ? 'page' : undefined}>{t(`chrome.${id}`)}</a>{/each}
      <!-- The cart and the account come with the orders (issue #29); until then they are only drawn. -->
      <span class="icons" aria-hidden="true"><span class="ico cart">{@html cart}<b>0</b></span><span class="ico">{@html user}</span></span>
    </nav>
  </header>
  <main class="cols wrap">
    <div class="head">
      <h1>{@html claim}</h1>
      {#if tabs}<div class="tabs"><span class="tag cur" aria-current="page">{t('common.info')}</span><a class="tag" href={pathOf('/contact', locale)}>{t('common.book_now')}</a></div>{/if}
    </div>
    <div class="col a">{@render left()}</div>
    <div class="col b">{@render right()}</div>
  </main>
  <footer class="foot wrap"><span>{t('chrome.copyright')}</span><nav aria-label={t('chrome.languages')}><LangSwitch {langs} /></nav></footer>
</div>
{@html inline(LANG)}
