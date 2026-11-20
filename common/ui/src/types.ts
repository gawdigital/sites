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


/** One choice of a form's select or of its pills. */
export interface Choice {
  value: string;
  label: string;
}
