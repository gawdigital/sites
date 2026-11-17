// Locale routing shared by the sites: English owns the bare paths, every other locale carries a prefix, and the
// paths themselves are English in every language (`/de/contact`, not `/de/kontakt`).
export const DEFAULT_LOCALE = 'en';

export const LOCALES = ['en', 'de', 'cs'] as const;

export type Locale = (typeof LOCALES)[number];

export const PREFIXED = LOCALES.filter((l) => l !== DEFAULT_LOCALE);

export const isLocale = (v: string): v is Locale => (LOCALES as readonly string[]).includes(v);

export const isPrefixed = (v: string): v is Locale => (PREFIXED as readonly string[]).includes(v);

export const prefixOf = (locale: string): string => (locale === DEFAULT_LOCALE ? '' : `/${locale}`);

export const localeOf = (pathname: string): Locale =>
  PREFIXED.find((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`)) ?? DEFAULT_LOCALE;

/** The route without its locale prefix: `/de/contact` → `/contact`, `/de` → `/`. */
export const routeOf = (pathname: string, locale: string = localeOf(pathname)): string =>
  pathname.slice(prefixOf(locale).length) || '/';

/** The path of a route in a locale: `('/contact', 'de')` → `/de/contact`, `('/', 'de')` → `/de`. */
export const pathOf = (route: string, locale: string): string =>
  `${prefixOf(locale)}${route === '/' ? '' : route}` || '/';
