<script lang="ts">
  // Every page's document, in the approved design's order: the shared gradients and the app icon symbol, then the
  // frame with the hatch, the header, the page's <main>, the footer and the noise, then the design's small inline
  // scripts. Pages are prerendered without client-side rendering, so this is the whole of what ships.
  import type { Snippet } from 'svelte';

  import Alternates from '@gaw/i18n/Alternates.svelte';
  import { DEFAULT_LOCALE, localeOf, pathOf, routeOf } from '@gaw/i18n/locale.ts';
  import { LANG, LANG_HEAD } from '@gaw/i18n/scripts.ts';
  import Footer from '@gaw/ui/Footer.svelte';
  import Hatch from '@gaw/ui/Hatch.svelte';
  import Header from '@gaw/ui/Header.svelte';
  import { GRADIENTS } from '@gaw/ui/icons.ts';
  import { HATCH, MENU, THEME, THEME_HEAD, inline } from '@gaw/ui/scripts.ts';
  import { stylesheet } from '@gaw/ui/styles.ts';
  import type { LangLink, NavItem } from '@gaw/ui/types.ts';
  import { page } from '$app/state';

  import appicon from './art/appicon.svg?raw';
  import badge from './art/badge.svg?raw';
  import { NAV, ORIGIN, PAGES, SITE_CSS, type PageName } from './site.ts';
  import { get } from './translations/index.ts';

  let {
    name,
    title,
    noindex = false,
    before,
    children,
  }: { name: PageName; title: string; noindex?: boolean; before?: Snippet; children: Snippet } = $props();

  const { t } = get();
  const meta = $derived(PAGES[name]);
  const locale = $derived(localeOf(page.url.pathname));
  // The address without its locale: the language links keep a form's result page (`/contact/sent`) on itself.
  const route = $derived(routeOf(page.url.pathname, locale));

  const items: NavItem[] = $derived(
    NAV.map(({ id, route: to }) => ({
      label: t(`chrome.${id}`),
      href: to === undefined ? undefined : pathOf(to.replace(/#.*/, ''), locale) + (to.match(/#.*/)?.[0] ?? ''),
      current: id === meta.nav,
    })),
  );
  // CS · EN · DE, in the design's order: the current one is not a link.
  const langs: LangLink[] = $derived(
    (['cs', 'en', 'de'] as const).map((code) => ({
      code,
      label: code.toUpperCase(),
      href: pathOf(route, code),
      current: code === locale,
    })),
  );
  const labels = $derived({
    menu: t('chrome.menu'),
    close: t('chrome.close_menu'),
    theme: t('chrome.theme'),
    soon: t('chrome.coming_soon'),
  });
  const icon = appicon.slice(appicon.indexOf('>') + 1, appicon.lastIndexOf('</svg>')).trim();
  const defs = `${GRADIENTS}<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="appicon" viewBox="0 0 1254 1254">${icon}</symbol></svg>`;
</script>

<svelte:head>
  <!-- Before anything renders: an English page sends a visitor who prefers German or Czech to that locale. -->
  {#if locale === DEFAULT_LOCALE}{@html inline(LANG_HEAD)}{/if}
  <title>{title}</title>
  {@html stylesheet(meta.head, [...meta.tail, SITE_CSS])}
  {@html inline(THEME_HEAD)}
  {#if noindex}<meta name="robots" content="noindex" />{:else}<Alternates origin={ORIGIN} route={meta.route} {locale} />{/if}
</svelte:head>

{@html defs}<div class="frame"><Hatch page={name} /><Header {badge} home={pathOf('/', locale)} {items} {langs} {labels} />
{@render before?.()}<main>{@render children()}</main>
<Footer {langs} themeLabel={labels.theme}><span>{@html t('chrome.copyright')}</span><span>{t('chrome.trademark')}</span></Footer><div class="noise"></div></div>{@html inline(THEME, MENU, HATCH, LANG)}
