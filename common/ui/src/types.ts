/** One item of the main navigation. */
export interface NavItem {
  label: string;
  /** Omitted for an item that is shown but not available yet. */
  href?: string;
  current?: boolean;
  /** Another site: the link opens in a new tab and carries the external arrow. */
  external?: boolean;
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

/**
 * A desktop background hatch group pinned to the page's boxes. A box is `main`'s `block`-th block (its children
 * that are not a divider), or that block's `child`-th child when `child` is 0 or more. The group's top is `dy` from
 * the top (`yEdge` 0) or bottom (1) of one box, its left `dx` from the left (`xEdge` 0) or right (1) edge of
 * another, in the design's pixels.
 */
export type HatchPin = readonly [
  shape: 1 | 2 | 3,
  yBlock: number,
  yChild: number,
  yEdge: 0 | 1,
  dy: number,
  xBlock: number,
  xChild: number,
  xEdge: 0 | 1,
  dx: number,
];

/**
 * A phone background hatch group hung from the page's cards (`main`'s `.card` elements, in document order). The
 * group's top is `dy` from the top (`yEdge` 0) or bottom (1) of one card, its left `dx` from the left (`xEdge` 0) or
 * right (1) edge of another, in CSS pixels. It keeps that relation at every phone width, and is left out wherever it
 * would reach text, a heading, a divider, a button or the footer outside the cards.
 */
export type PhoneHatchPin = readonly [
  shape: 1 | 2 | 3,
  yCard: number,
  yEdge: 0 | 1,
  dy: number,
  xCard: number,
  xEdge: 0 | 1,
  dx: number,
];
