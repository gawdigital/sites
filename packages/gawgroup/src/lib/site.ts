// What each page of the site is: its route, which navigation item it sits under, and the stylesheet fragments it is
// composed from, after the shared base: the shared form and card specs, the group's theme, then the page's own.
import { BRANDS } from '@gaw/company/brands.ts';
import { ADDITIONS_CSS, CONTACT_CSS, GAWGROUP_CSS, PRIVACY_CSS, formCss, formFieldsCss } from '@gaw/ui/styles.ts';

import home from './styles/home.css?raw';
import pages from './styles/pages.css?raw';

/** The canonical origin, for canonical and hreflang links. */
export const ORIGIN = 'https://gawgroup.cz';

export type PageName = 'home' | 'contact' | 'privacy' | 'error';

export type NavId = 'home' | 'digital' | 'studio' | 'contact';

export interface PageMeta {
  route: string;
  nav?: NavId;
  /** The stylesheet after the shared base and mobile rules; the theme comes after the shared specs it recolours. */
  css: readonly string[];
}

export const PAGES: Record<PageName, PageMeta> = {
  home: { route: '/', nav: 'home', css: [GAWGROUP_CSS, home] },
  contact: {
    route: '/contact',
    nav: 'contact',
    css: [formCss(''), formFieldsCss(''), CONTACT_CSS, ADDITIONS_CSS, GAWGROUP_CSS, pages],
  },
  privacy: { route: '/privacy', css: [CONTACT_CSS, PRIVACY_CSS, GAWGROUP_CSS, pages] },
  error: { route: '/', css: [ADDITIONS_CSS, GAWGROUP_CSS, pages] },
};

/** The main navigation, in the design's order: the brands are links to their own sites. */
export const NAV: readonly { id: NavId; route?: string; url?: string }[] = [
  { id: 'home', route: '/' },
  ...BRANDS.map(({ id, url }) => ({ id, url })),
  { id: 'contact', route: '/contact' },
];

/** The footer's links. */
export const FOOT = [
  { id: 'home', route: '/' },
  { id: 'contact', route: '/contact' },
  { id: 'privacy', route: '/privacy' },
] as const;
