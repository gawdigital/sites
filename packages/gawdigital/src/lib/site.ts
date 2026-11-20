// What each page of the site is: its route, which navigation item it sits under, and the stylesheet fragments the
// approved design composes it from (head before the shared mobile rules, tail after them).
import { ADDITIONS_CSS, CONTACT_CSS, PRIVACY_CSS, formCss, formFieldsCss } from '@gaw/ui/styles.ts';

import formFieldsTokens from './styles/form-fields-tokens.css?raw';
import formTokens from './styles/form-tokens.css?raw';
import homeTail from './styles/home-tail.css?raw';
import home from './styles/home.css?raw';
import hub from './styles/hub.css?raw';
import hubgrid from './styles/hubgrid.css?raw';
import midiHeadM5 from './styles/midi-head-m5.css?raw';
import midiHead from './styles/midi-head.css?raw';
import midiTail from './styles/midi-tail.css?raw';
import product from './styles/product.css?raw';
import support from './styles/support.css?raw';

// The shared form spec in this site's colours: its token rules go where the design declares them.
const contact = CONTACT_CSS;
const privacy = PRIVACY_CSS;
const form = formCss(formTokens);
const formFields = formFieldsCss(formFieldsTokens);

/** The additions on top of the design (the form's error line, the live verification widget, the error page). */
export const SITE_CSS = ADDITIONS_CSS;

/** The canonical origin, for canonical and hreflang links. */
export const ORIGIN = 'https://gawdigital.cz';

export type PageName = 'home' | 'midi-control' | 'support' | 'midi-support' | 'contact' | 'privacy' | 'error';

export type NavId = 'home' | 'apps' | 'games' | 'support' | 'contact';

export interface PageMeta {
  route: string;
  nav?: NavId;
  head: readonly string[];
  tail: readonly string[];
}

export const PAGES: Record<PageName, PageMeta> = {
  home: { route: '/', nav: 'home', head: [home], tail: [homeTail] },
  'midi-control': { route: '/apps/midi-control', nav: 'apps', head: [product], tail: [midiTail, midiHead, midiHeadM5] },
  support: { route: '/support', nav: 'support', head: [home, product], tail: [support, hub, form, hubgrid, formFields] },
  'midi-support': { route: '/apps/midi-control/support', nav: 'apps', head: [product], tail: [midiTail, support] },
  contact: { route: '/contact', nav: 'contact', head: [home, product], tail: [support, form, formFields, contact] },
  privacy: { route: '/privacy', head: [home, product], tail: [support, contact, privacy] },
  error: { route: '/', head: [home, product], tail: [support] },
};

/** The main navigation, in the design's order. APPS opens the one app's page; GAMES has no section yet: shown, not clickable. */
export const NAV: readonly { id: NavId; route?: string }[] = [
  { id: 'home', route: '/' },
  { id: 'apps', route: '/apps/midi-control' },
  { id: 'games' },
  { id: 'support', route: '/support' },
  { id: 'contact', route: '/contact' },
];
