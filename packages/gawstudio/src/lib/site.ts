// What the site is made of: its pages, its navigation, the studio's address, and the one stylesheet every page
// ships inline. The design is G.A.W.Studio's own (issue #29): of the other sites it uses the typeface, the phone's
// menu and the form spec (the fields of `@gaw/ui`, in this site's colours).
import font from '@gaw/ui/assets/kumbh.ttf?url';
import { formFieldsCss } from '@gaw/ui/styles.ts';

import grain from './art/grain.png?url';
import form from './styles/form.css?raw';
import css from './styles/site.css?raw';

/** The canonical origin, for canonical and hreflang links once the site is launched. */
export const ORIGIN = 'https://gawstudio.cz';

/**
 * Until the launch the pages ask not to be indexed: the copy is provisional and gawstudio.cz still serves the old
 * site. Turning this on swaps the `noindex` for the canonical and hreflang links.
 */
export const LAUNCHED = false;

export type Service = 'recording' | 'mix' | 'mastering';

/** A service's second page: recording is booked, the online services are ordered. */
export type ActionPage = `${Service}_action`;

export type PageName = 'home' | Service | ActionPage | 'contact' | 'error';

export type NavId = Exclude<PageName, ActionPage | 'error'>;

export const PAGES: Record<PageName, { route: string; nav?: NavId }> = {
  home: { route: '/', nav: 'home' },
  recording: { route: '/recording', nav: 'recording' },
  mix: { route: '/mix', nav: 'mix' },
  mastering: { route: '/mastering', nav: 'mastering' },
  recording_action: { route: '/recording/book', nav: 'recording' },
  mix_action: { route: '/mix/order', nav: 'mix' },
  mastering_action: { route: '/mastering/order', nav: 'mastering' },
  contact: { route: '/contact', nav: 'contact' },
  error: { route: '/' },
};

/** The main navigation, in the design's order. */
export const NAV: readonly NavId[] = ['home', 'recording', 'mix', 'mastering', 'contact'];

/** Where the studio is; the country follows in the page's language. */
export const STUDIO = {
  street: 'Šimáčkova 906/21',
  city: '170 00 Praha 7 – Holešovice',
  map: 'https://www.google.com/maps/search/?api=1&query=%C5%A0im%C3%A1%C4%8Dkova+906%2F21%2C+170+00+Praha+7',
} as const;

/** Without JavaScript the overlay cannot open, so a phone keeps the menu's links on the page, under the badge. */
const NOSCRIPT =
  '@media (max-width:860px){.mnav{display:none}.top{padding-top:150px}.nav{display:flex;position:static;height:auto;flex-wrap:wrap;gap:14px 22px;padding:0 16px 28px}.nav .icons{display:none}}';

/** The font is asked for before the stylesheet is parsed, as on the other sites (`@gaw/ui/styles.ts`). */
export const STYLES = `<link rel="preload" href="${font}" as="font" type="font/ttf" crossorigin><style>${css
  .replace('%FONT%', font)
  .replace('%GRAIN%', grain)}</style><noscript><style>${NOSCRIPT}</style></noscript>`;

/**
 * The form pages' rules, after the page's own: the shared field spec, then this site's colours and its form layout.
 * The spec's tokens are the indicator's two colours.
 */
export const FORM_STYLES = `<style>${formFieldsCss('.fg{--fok:var(--green);--fbad:var(--pink)}')}${form}</style>`;

/**
 * What a mix or mastering order offers: who can do it, whether the tracks can be prepared first, and the lowest price
 * in euros. Read from the original site's shop on 2026-11-20; to be confirmed before orders open (issue #29).
 */
export const OFFERS = {
  mix: { engineers: ['Libor', 'Nèro'], preprocess: true, from: 200 },
  mastering: { engineers: ['Libor', 'Risto'], preprocess: false, from: 100 },
} as const;

/** A heading with its last line in the accent colour, as the design sets its claims: `Make it<br>happen...`. */
export const accent = (html: string) => html.replace(/^(.*<br>)?(.*)$/s, '$1<em>$2</em>');
