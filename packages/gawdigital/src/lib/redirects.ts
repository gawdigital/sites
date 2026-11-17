// The addresses the app's pages had before the site moved them under `/apps/`, with the privacy policy now shared
// by the whole site. Every locale's prefixed form moves the same way.
const MAP: Record<string, string> = {
  '/midi-control': '/apps/midi-control',
  '/midi-control/support': '/apps/midi-control/support',
  '/midi-control/privacy': '/privacy',
};

/** Where an old address now lives, locale prefix kept, or `undefined` for one that did not move. */
export function movedTo(pathname: string): string | undefined {
  const m = /^(\/(?:de|cs))?(\/.*?)\/?$/.exec(pathname);
  if (!m) return undefined;
  const to = MAP[m[2]];
  return to === undefined ? undefined : (m[1] ?? '') + to;
}
