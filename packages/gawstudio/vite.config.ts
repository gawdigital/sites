import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { typegen } from '@sveltekit-i18n/typegen';
import { defineConfig } from 'vite';

import { LOCALES, pathOf } from '@gaw/i18n/locale.ts';

// Every route of `PAGES` in `src/lib/site.ts`, which cannot be imported here: it pulls in the stylesheets and
// the font. A page added there is added here.
const PAGES = ['/', '/recording', '/recording/book', '/mix', '/mix/order', '/mastering', '/mastering/order', '/contact'];

// Explicit entries rather than crawling: a prefixed locale is reachable only through the language switch, and a
// crawler that misses one link silently drops it from the build.
const entries = LOCALES.flatMap((locale) => PAGES.map((route) => pathOf(route, locale))) as `/${string}`[];

export default defineConfig({
  plugins: [
    sveltekit({ adapter: adapter(), prerender: { entries } }),
    // Writes `src/i18n-schema.d.ts` from the config's own loaders, on `vite build` and while `vite dev` runs.
    typegen({ config: 'src/lib/translations/index.ts', extractParams: { from: 'sveltekit-i18n' } }),
    // `dev:https` serves over HTTPS with a self-signed certificate (the browser asks once), for a phone on the network.
    ...(process.env.HTTPS ? [basicSsl()] : []),
  ],
});
