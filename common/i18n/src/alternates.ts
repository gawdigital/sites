import { DEFAULT_LOCALE, LOCALES, pathOf } from './locale.ts';

export interface Alternate {
  hreflang: string;
  href: string;
}

/**
 * The hreflang alternates of one route: one per locale, plus `x-default` pointing at the English page.
 * `origin` is the site's canonical origin, without a trailing slash.
 */
export function alternates(origin: string, route: string): Alternate[] {
  return [
    ...LOCALES.map((locale) => ({ hreflang: locale, href: origin + pathOf(route, locale) })),
    { hreflang: 'x-default', href: origin + pathOf(route, DEFAULT_LOCALE) },
  ];
}
