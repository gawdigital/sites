import type { Handle } from '@sveltejs/kit/hooks';
import { sequence } from '@sveltejs/kit/hooks';

import { movedTo } from '#lib/redirects.ts';
import { handle as i18n } from '#lib/translations/index.ts';

/** The app's old addresses answer with a permanent redirect to where they live now. */
const redirects: Handle = ({ event, resolve }) => {
  const to = movedTo(event.url.pathname);
  if (to === undefined) return resolve(event);
  return new Response(null, { status: 301, headers: { location: to + event.url.search } });
};

// The i18n hook sets `<html lang>` and `dir` on every page it renders, prerendered or not.
export const handle = sequence(redirects, i18n);
