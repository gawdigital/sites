<script lang="ts">
  // Every page's document: the shared gradients, then the frame with the header, the page's <main>, the footer and
  // the noise, then the small inline scripts. Pages are prerendered without client-side rendering, so this is the
  // whole of what ships.
  import type { Snippet } from 'svelte';

  import Alternates from '@gaw/i18n/Alternates.svelte';
  import { DEFAULT_LOCALE, localeOf, pathOf, routeOf } from '@gaw/i18n/locale.ts';
  import { LANG, LANG_HEAD } from '@gaw/i18n/scripts.ts';
  import Footer from '@gaw/ui/Footer.svelte';
  import Header from '@gaw/ui/Header.svelte';
  import { GRADIENTS } from '@gaw/ui/icons.ts';
  import { FIT, FIT_HEAD, MENU, SPECULATION, THEME, THEME_HEAD, TILT, TOUCH, inline } from '@gaw/ui/scripts.ts';
  import { stylesheet } from '@gaw/ui/styles.ts';
  import type { LangLink, NavItem } from '@gaw/ui/types.ts';
  import { GROUP } from '@gaw/company/brands.ts';
  import { page } from '$app/state';

  import badge from './art/badge.svg?raw';
  import { FOOT, NAV, ORIGIN, PAGES, type PageName } from './site.ts';
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
    NAV.map(({ id, route: to, url }) => ({
      label: t(`chrome.${id}`),
      href: url ?? pathOf(to ?? '/', locale),
      external: url !== undefined,
      current: id === meta.nav,
    })),
  );
  // EN · DE · CS, in the design's order: the current one is not a link.
  const langs: LangLink[] = $derived(
    (['en', 'de', 'cs'] as const).map((code) => ({
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
    soon: '',
    external: t('common.opens_in_a_new_tab'),
  });
</script>

<svelte:head>
  <!-- Before anything renders: an English page sends a visitor who prefers German or Czech to that locale. -->
  {#if locale === DEFAULT_LOCALE}{@html inline(LANG_HEAD)}{/if}
  <title>{title}</title>
  {@html stylesheet([], meta.css)}
  {@html inline(THEME_HEAD, FIT_HEAD)}
  {@html SPECULATION}
  {#if noindex}<meta name="robots" content="noindex" />{:else}<Alternates origin={ORIGIN} route={meta.route} {locale} />{/if}
</svelte:head>

{@html GRADIENTS}<div class={['frame', name !== 'home' && 'sub']}><Header {badge} name={GROUP.name} home={pathOf('/', locale)} {items} {langs} {labels} />
{@render before?.()}<main>{@render children()}</main>
<Footer {langs} themeLabel={labels.theme}><span>{t('chrome.copyright')}</span><nav class="fm">{#each FOOT as { id, route: to } (id)}<a href={pathOf(to, locale)} aria-current={to === meta.route && name !== 'error' ? 'page' : undefined}>{t(`chrome.${id}`)}</a>{/each}</nav></Footer><div class="noise"></div></div>{@html inline(FIT, THEME, MENU, TILT, TOUCH, LANG)}
