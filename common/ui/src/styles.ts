// The design's shared stylesheet, emitted inline and verbatim so every page renders exactly as the approved
// mockups: base rules first, then the page's own rules, then the mobile rules, then the page's tail.
import font from './assets/kumbh.ttf?url';
import noise from './assets/noise.png?url';
import additions from './styles/additions.css?raw';
import base from './styles/base.css?raw';
import contact from './styles/contact.css?raw';
import formFields from './styles/form-fields.css?raw';
import form from './styles/form.css?raw';
import gawgroup from './styles/gawgroup.css?raw';
import mobile from './styles/mobile.css?raw';
import privacy from './styles/privacy.css?raw';

/** The design's width: the desktop layout is drawn for a 1440 px window. */
const DESIGN_WIDTH = 1440;

/**
 * Between the mobile layout and the design's width, the desktop layout is shrunk to fit the window instead of running
 * off its right edge. With JavaScript, `scripts/fit-head.js` marks `<html>` with `fit` and the frame is scaled by a
 * transform, continuously; its height keeps filling the window, and the scrollbar stays so the width the scale is
 * taken from does not change under it. A transform leaves the layout box as tall as it was, so a negative margin
 * takes the difference out of the page; the body is a flow root, or that margin would collapse through it and leave
 * the body its full height. Screen only: a printed page has its own width.
 *
 * Without JavaScript the frame is zoomed out in 20 px steps, each to the width at its bottom, so it is never wider
 * than the window. That is only the fallback: WebKit keeps zoomed text at 9 px or more while the layout shrinks on.
 */
function narrowDesktop(): string {
  const rules: string[] = [];
  for (let w = DESIGN_WIDTH; w > 768; w -= 20) {
    const zoom = +((w - 20) / DESIGN_WIDTH).toFixed(4);
    rules.push(`@media (min-width:769px) and (max-width:${w - 0.02}px){.frame{zoom:${zoom};min-height:calc(100vh / ${zoom})}}`);
  }
  rules.push(
    '@media screen{html.fit{overflow-y:scroll}html.fit body{display:flow-root}' +
      'html.fit .frame{zoom:1;transform:scale(var(--fit,1));transform-origin:0 0;min-height:calc(100vh / var(--fit,1));' +
      'margin-bottom:var(--fit-m,0px)}}',
  );
  return rules.join('\n');
}

export const BASE_CSS = `${base.replace('%FONT%', font).replace('%NOISE%', noise)}\n${narrowDesktop()}`;
export const MOBILE_CSS = mobile;

/**
 * The font is asked for before the stylesheet is parsed, so it is in hand when the page is first laid out: found only
 * through the `@font-face` rule, it came late enough that Safari painted a reloaded page with its text still invisible.
 * A font is always fetched in CORS mode, so the preload is too, or the browser would not reuse it.
 */
export const FONT_PRELOAD = `<link rel="preload" href="${font}" as="font" type="font/ttf" crossorigin>`;

/** The font's preload, then one `<style>` element in the design's cascade order. */
export function stylesheet(head: readonly string[], tail: readonly string[]): string {
  return `${FONT_PRELOAD}<style>${BASE_CSS}${head.join('')}${MOBILE_CSS}${tail.join('')}</style>`;
}

// The forms: one spec for every site. Sizes, roundings, shadows, spacing and the indicator's behaviour are in the
// fragments below; only the colours are the site's. They come from the theme's variables (`--line`, `--chip`,
// `--card`, `--text`, `--soft`, `--dim`, `--blue`, `--pink`, `--sh1`, `--x`, `--xr`, `--xr2`, `--xg`, `--on-x`,
// `--on-blue`, `--sa`) and from the form's own tokens, which a site hands over as a few `:root` rules for both themes.

/** A fragment with the site's token rules set where the design declares them. */
const withTokens = (css: string, tokens: string) => css.replace('%TOKENS%', () => tokens.trim());

/**
 * The form card, its groups and labels, the topic pills, the verification box with the send button, the privacy
 * note and the sent state. `tokens` declares `--fb` (a bordered control's edge, 3:1 against the card and the field)
 * and `--fbg` (the verification box's fill).
 */
export const formCss = (tokens: string): string => withTokens(form, tokens);

/**
 * The fields (`.fg`): 70 px high, the label inside, the indicator dot in the chevron's column. Goes after
 * `formCss` in the cascade. `tokens` declares `--fok` and `--fbad`: the indicator while a value passes validation
 * and while it does not.
 */
export const formFieldsCss = (tokens: string): string => withTokens(formFields, tokens);

/** The contact page's two columns, the company card with its details, and the copy buttons. */
export const CONTACT_CSS = contact;

/**
 * The additions on top of the approved design, last in the cascade: the form's error line, the live Turnstile widget
 * in the verification box, the form while it is being sent, and the error page.
 */
export const ADDITIONS_CSS = additions;

/** The privacy page: the contact page's shell, its sections in the company card's rows, two cards a row on desktop. */
export const PRIVACY_CSS = privacy;

/**
 * The G.A.W.Group theme, beside the default one (G.A.W.Digital's, the tokens of `base.css`): the gold palette in both
 * appearances, and the group's own type, dividers, cards and footer over the shared layout. It goes last in a
 * page's cascade, after the shared form, contact and privacy fragments it recolours.
 */
export const GAWGROUP_CSS = gawgroup;
