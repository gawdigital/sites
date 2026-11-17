<script lang="ts">
  // Every page's document, in the approved design's order: the shared gradients and the app icon symbol, then the
  // frame with the hatch, the header, the page's <main>, the footer and the noise, then the design's small inline
  // scripts. Pages are prerendered without client-side rendering, so this is the whole of what ships.
  import type { Snippet } from 'svelte';

  import Alternates from '@gaw/i18n/Alternates.svelte';
  import { LOCALES, localeOf, pathOf, routeOf } from '@gaw/i18n/locale.ts';
  import Footer from '@gaw/ui/Footer.svelte';
  import Hatch from '@gaw/ui/Hatch.svelte';
  import Header from '@gaw/ui/Header.svelte';
  import { GRADIENTS } from '@gaw/ui/icons.ts';
  import LangBar from '@gaw/ui/LangBar.svelte';
  import { HATCH, LANGBAR, MENU, THEME, THEME_HEAD, inline } from '@gaw/ui/scripts.ts';
  import { stylesheet } from '@gaw/ui/styles.ts';
  import type { LangLink, LangOffer, NavItem } from '@gaw/ui/types.ts';
  import { page } from '$app/state';

  import appicon from './art/appicon.svg?raw';
  import badge from './art/badge.svg?raw';
  import { NAV, ORIGIN, PAGES, SITE_CSS, type PageName } from './site.ts';
  import { BASE, get } from './translations/index.ts';

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
  const offers: LangOffer[] = $derived(
    LOCALES.filter((code) => code !== locale).map((code) => ({
      code,
      href: pathOf(route, code),
      text: BASE[code].langbar.text,
      link: BASE[code].langbar.link,
      close: BASE[code].langbar.close,
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
  <title>{title}</title>
  {@html stylesheet(meta.head, [...meta.tail, SITE_CSS])}
  {@html inline(THEME_HEAD)}
  {#if noindex}<meta name="robots" content="noindex" />{:else}<Alternates origin={ORIGIN} route={meta.route} {locale} />{/if}
</svelte:head>

{@html defs}<div class="frame"><Hatch page={name} /><Header {badge} {items} {langs} {labels} />
{@render before?.()}<main>{@render children()}</main>
<Footer {langs} themeLabel={labels.theme}><span>{@html t('chrome.copyright')}</span><span>{t('chrome.trademark')}</span></Footer><div class="noise"></div></div><LangBar {offers} current={locale} />{@html inline(THEME, MENU, HATCH, LANGBAR)}
