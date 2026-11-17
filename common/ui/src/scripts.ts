// The design's interactivity is a handful of small plain scripts, inlined into each prerendered page: no
// hydration, no client bundle. Every page works without them.
import dither from './scripts/dither.js?raw';
import fit from './scripts/fit.js?raw';
import fitHead from './scripts/fit-head.js?raw';
import hatch from './scripts/hatch.js?raw';
import menu from './scripts/menu.js?raw';
import theme from './scripts/theme.js?raw';
import themeHead from './scripts/theme-head.js?raw';
import tilt from './scripts/tilt.js?raw';
import touch from './scripts/touch.js?raw';

export const THEME_HEAD = themeHead;
/** Scales the desktop frame to a window narrower than the design: the head part before the first paint. */
export const FIT_HEAD = fitHead;
export const FIT = fit;
export const THEME = theme;
export const MENU = menu;
export const HATCH = hatch;
export const TILT = tilt;
export const DITHER = dither;
/** iOS Safari applies :active (the touch stand-in for the hover effects) only once a page listens for touches. */
export const TOUCH = touch;

/**
 * Speculation rules: a page a visitor is about to open (a pointer resting on its link, or a press starting) is
 * fetched ahead, so the navigation lands at once. Only a prefetch, never a prerender, so no page runs its scripts
 * unseen; the API route is left alone. Browsers without the API ignore the element.
 */
export const SPECULATION = `<script type="speculationrules">${JSON.stringify({
  prefetch: [
    {
      where: { and: [{ href_matches: '/*' }, { not: { href_matches: '/api/*' } }] },
      eagerness: 'moderate',
    },
  ],
})}</script>`;

/** A script element around trusted, inline source. */
export function inline(...sources: string[]): string {
  return sources.map((s) => `<script>${s}</script>`).join('');
}
