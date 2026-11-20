// The design's interactivity is a handful of small plain scripts, inlined into each prerendered page: no
// hydration, no client bundle. Every page works without them.
import copy from './scripts/copy.js?raw';
import dither from './scripts/dither.js?raw';
import fields from './scripts/fields.js?raw';
import fit from './scripts/fit.js?raw';
import fitHead from './scripts/fit-head.js?raw';
import hatch from './scripts/hatch.js?raw';
import menu from './scripts/menu.js?raw';
import submit from './scripts/submit.js?raw';
import theme from './scripts/theme.js?raw';
import themeHead from './scripts/theme-head.js?raw';
import tilt from './scripts/tilt.js?raw';
import touch from './scripts/touch.js?raw';
import turnstile from './scripts/turnstile.js?raw';

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

// The forms' scripts, each with its few visible strings as `%NAME%` placeholders, filled in per locale by `script`.
// They find the form card by its id, `contact`, and work on the markup of the form components.

/** The fields' indicators. Strings: `FILLED`, `INVALID`, `EMPTY`, read to screen readers. */
export const FIELDS = fields;
/** The in-page submit: posts the form, asks for JSON and stays on the page. Strings: `MESSAGES`, the error line by error code. */
export const SUBMIT = submit;
/** The live Turnstile widget in the verification box (`.ts[data-sitekey]`), in the page's theme and language. */
export const TURNSTILE = turnstile;
/** The copy buttons (`.cp`) and their live note (`#cnote`). Strings: `COPY`, `COPIED`, `NOTE` (with `%s` for what was copied). */
export const COPY = copy;

/** A value as a JavaScript literal that is safe inside a `<script>` element. */
const literal = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/** One `<script>` element around a source, its `%NAME%` placeholders replaced by the given values. */
export function script(source: string, strings: Record<string, unknown> = {}): string {
  const filled = source.trim().replace(/%([A-Z_]+)%/g, (whole, key: string) =>
    key in strings ? literal(strings[key]) : whole,
  );
  return `<script>${filled}</script>`;
}
