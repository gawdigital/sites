import type { Config } from 'sveltekit-i18n';
import { defineI18n } from 'sveltekit-i18n/kit';

import { LOCALES, localeOf } from '@gaw/i18n/locale.ts';
import cs from './cs.json';
import de from './de.json';
import en from './en.json';

/**
 * One namespace per page, loaded only where that page renders. The routes match the whole pathname, locale prefix
 * included, and the contact form's result pages (`/contact/sent`, `/support/invalid` …) with their page.
 */
const page = (path: string) => new RegExp(`^(?:/(?:de|cs))?${path}$`);

export const NAMESPACES = [
  { namespace: 'home', routes: [page('/?')] },
  { namespace: 'midi', routes: [page('/apps/midi-control')] },
  { namespace: 'midisupport', routes: [page('/apps/midi-control/support')] },
  { namespace: 'support', routes: [page('/support(?:/[a-z]+)?')] },
  { namespace: 'contact', routes: [page('/contact(?:/[a-z]+)?')] },
  { namespace: 'privacy', routes: [page('/privacy')] },
  { namespace: 'web', routes: [page('/web')] },
];

/** The shared strings (`common`, `chrome`, `form`, `error`) are base translations: every page has them. */
export const BASE = { en, de, cs } as const;

export const config = {
  translations: BASE,
  loaders: NAMESPACES.map(({ namespace, routes }) => ({
    locale: LOCALES,
    namespace,
    routes,
    loader: async ({ locale, namespace }) => (await import(`./${namespace}/${locale}.json`)).default,
  })),
} as const satisfies Config;

/** The locale comes off the path, never off `Accept-Language`: an unprefixed path is English. */
export const { handle, load, use, get } = defineI18n(config, {
  preferredLocale: (event) => localeOf(event.url.pathname),
});
