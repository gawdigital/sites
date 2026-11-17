import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { typegen } from '@sveltekit-i18n/typegen';
import { defineConfig } from 'vite';

import { LOCALES, pathOf } from '@gaw/i18n/locale.ts';

import { FORM_STATES } from './src/lib/forms.ts';

const PAGES = ['/', '/apps/midi-control', '/apps/midi-control/support', '/support', '/contact', '/privacy'];
const FORMS = ['/support', '/contact'];

// Explicit entries rather than crawling: a prefixed locale and a form's result page are reachable only through the
// language switcher or a redirect, and a crawler that misses one link silently drops it from the build.
const entries = LOCALES.flatMap((locale) => [
  ...PAGES.map((route) => pathOf(route, locale)),
  ...FORMS.flatMap((form) => FORM_STATES.map((state) => pathOf(`${form}/${state}`, locale))),
]) as `/${string}`[];

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter(),
      prerender: {
        entries,
        // The Mac App Store badge links to `#app-store` until the app's store page exists (an owner step).
        handleMissingId: ({ id, message }) => {
          if (id !== 'app-store') throw new Error(message);
        },
      },
    }),
    // Writes `src/i18n-schema.d.ts` from the config's own loaders, on `vite build` and while `vite dev` runs.
    typegen({ config: 'src/lib/translations/index.ts', extractParams: { from: 'sveltekit-i18n' } }),
    // `dev:https` serves over HTTPS with a self-signed certificate (the browser asks once), for a phone on the network.
    ...(process.env.HTTPS ? [basicSsl()] : []),
  ],
});
