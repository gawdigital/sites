/** One item of the main navigation. */
export interface NavItem {
  label: string;
  /** Omitted for an item that is shown but not available yet. */
  href?: string;
  current?: boolean;
}

/** One language of the CS·EN·DE switcher. */
export interface LangLink {
  code: string;
  label: string;
  href: string;
  current: boolean;
}

/** The language bar's offer of one other locale, written in that locale. */
export interface LangOffer {
  code: string;
  href: string;
  text: string;
  link: string;
  close: string;
}
