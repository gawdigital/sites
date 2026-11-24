import type { Locale } from '@gaw/i18n/locale.ts';
import type { HatchPin, PhoneHatchPin } from '@gaw/ui/types.ts';

import type { PageName } from './site.ts';

type Pins = readonly HatchPin[];

// The desktop's background hatch, pinned to the boxes as the design placed it on the 1320 px column: each group keeps
// its offset from the top or bottom edge of the box it hangs from, and from the left or right edge of the box it sits
// beside (where it crosses the gap between two columns, the columns' inner edge, which the narrower column left in
// place). So it holds whatever the column's width. Each language keeps its own arrangement: the design's hatch was
// searched around each language's text, so a page may hang different groups, or the same ones elsewhere, in Czech or
// German. The blocks are `main`'s children that are not dividers. The phone hangs its own groups from the cards
// (`PHONE_PINS`); pages listed in neither place theirs by the script's search.
const same = (pins: Pins): Record<Locale, Pins> => ({ en: pins, cs: pins, de: pins });

export const HATCH_PINS: Partial<Record<PageName, Record<Locale, Pins>>> = {
  // over the app card's top edge, at its right; under the duo, across the gap between its cards
  home: same([
    [1, 1, -1, 0, -360, 1, -1, 1, -431],
    [3, 2, -1, 1, -139, 2, 1, 0, -163],
  ]),
  // above the two projects, across their gap; over the partner card's bottom edge (German: a little lower)
  web: {
    en: [
      [2, 1, -1, 0, -498, 1, 1, 0, -76],
      [3, 2, -1, 1, -389, 2, -1, 0, 241],
    ],
    cs: [
      [2, 1, -1, 0, -498, 1, 1, 0, -76],
      [3, 2, -1, 1, -389, 2, -1, 0, 241],
    ],
    de: [
      [2, 1, -1, 0, -498, 1, 1, 0, -76],
      [3, 2, -1, 1, -382, 2, -1, 0, 241],
    ],
  },
  // above the right column; under the columns, across their gap (English only)
  support: {
    en: [
      [2, 1, -1, 0, -397, 1, 1, 1, -408],
      [1, 1, -1, 1, -192, 1, 1, 0, -151],
    ],
    cs: [[2, 1, -1, 0, -397, 1, 1, 1, -408]],
    de: [[2, 1, -1, 0, -397, 1, 1, 1, -408]],
  },
  // English: above the company card and under the form, across the columns' gap; Czech and German: one tall group
  // over the form's bottom edge, at the columns' gap
  contact: {
    en: [
      [1, 1, -1, 0, -390, 1, 1, 1, -405],
      [3, 1, 0, 1, -225, 1, 1, 0, -139],
    ],
    cs: [[2, 1, 0, 1, -392, 1, 1, 0, 1]],
    de: [[2, 1, 0, 1, -371, 1, 1, 0, -59]],
  },
  // above the first card, at its right; Czech: inside the first card, at its left, and over the second row's bottom
  // edge, at its right. Then under each row of two cards, across the columns' gap, into the space above the next
  // row's headings (Czech: from the third row on, as its second row already has one)
  privacy: {
    en: [
      [2, 1, -1, 0, -463, 1, -1, 1, -400],
      [3, 2, -1, 1, -415, 2, 1, 0, -210],
      [2, 3, -1, 1, -762, 3, 1, 0, -76],
      [1, 4, -1, 1, -377, 4, 1, 0, -210],
    ],
    cs: [
      [2, 1, -1, 0, 111, 1, -1, 0, 208],
      [1, 2, -1, 1, -190, 2, -1, 1, -432],
      [2, 3, -1, 1, -762, 3, 1, 0, -76],
      [1, 4, -1, 1, -377, 4, 1, 0, -210],
    ],
    de: [
      [2, 1, -1, 0, -463, 1, -1, 1, -400],
      [3, 2, -1, 1, -415, 2, 1, 0, -210],
      [2, 3, -1, 1, -762, 3, 1, 0, -76],
      [1, 4, -1, 1, -377, 4, 1, 0, -210],
    ],
  },
  // under the overview card, the features, the app windows and the compatibility card, at the columns' gap; under
  // the trial card, at its right (Czech: nothing under the compatibility card)
  'midi-control': {
    en: [
      [2, 1, -1, 1, -335, 2, 1, 0, -89],
      [1, 2, -1, 1, -154, 2, 0, 1, -392],
      [1, 3, -1, 1, -124, 3, 1, 0, -31],
      [2, 4, -1, 1, -333, 5, 0, 1, -331],
      [2, 5, 1, 1, -471, 5, 1, 1, -448],
    ],
    cs: [
      [2, 1, -1, 1, -335, 2, 1, 0, -89],
      [1, 2, -1, 1, -177, 2, 0, 1, -373],
      [2, 3, -1, 1, -229, 3, 1, 0, -1],
      [1, 5, 1, 1, -81, 5, 1, 1, -442],
    ],
    de: [
      [2, 1, -1, 1, -335, 2, 1, 0, -89],
      [1, 2, -1, 1, -154, 2, 0, 1, -392],
      [1, 3, -1, 1, -124, 3, 1, 0, -31],
      [2, 4, -1, 1, -333, 5, 0, 1, -331],
      [3, 5, 1, 1, -277, 5, 1, 1, -468],
    ],
  },
  // above the right card; under the two cards, across their gap; behind the questions' card
  'midi-support': {
    en: [
      [1, 1, -1, 0, -648, 1, 1, 1, -450],
      [1, 1, -1, 1, -140, 1, 1, 0, -224],
      [1, 2, 0, 1, 139, 2, -1, 0, 507],
    ],
    cs: [
      [1, 1, -1, 0, -648, 1, 1, 1, -450],
      [1, 1, -1, 1, -140, 1, 1, 0, -224],
      [1, 2, 0, 1, 151, 2, -1, 0, 507],
    ],
    de: [
      [1, 1, -1, 0, -648, 1, 1, 1, -450],
      [1, 1, -1, 1, -140, 1, 1, 0, -224],
      [1, 2, 0, 1, 163, 2, -1, 0, 507],
    ],
  },
};

type PhonePins = readonly PhoneHatchPin[];

// The phone's background hatch (up to 768 px), hung from the cards: each group keeps its offset from a card's top or
// bottom edge and from a card's left or right edge, so the same groups sit by the same cards at every phone width, in
// every language and while the window is resized. A group shows only through the gaps between the cards, the side
// margins and the space under a card; none reaches text, a heading, a divider, a button or the footer (the script
// leaves out one that would). `[3, c, 1, -233, c, 1, -150]` peeks out under card `c`, at its right;
// `[s, c, 0, dy, c, 0, -20]` runs down the left margin beside it, `[s, c, 0, dy, c, 1, -150]` down the right one.
// A page's head carries none: a phone has no room beside its title.
export const PHONE_PINS: Partial<Record<PageName, PhonePins>> = {
  // across the gap under the app card, at the right; down the left margin into the gap under the games card (hung
  // from the web card's top, so it stays beside the games card where the two share a row); under the web card
  home: [
    [3, 0, 1, -90, 0, 1, -159],
    [3, 2, 0, -106, 1, 0, -7],
    [3, 2, 1, -235, 2, 1, -200],
  ],
  // behind sveltekit-i18n's top-left corner (the gap under Curly, or the columns' gap); under Cesta, at its left
  web: [
    [2, 1, 0, -14, 1, 0, -21],
    [3, 2, 1, -233, 2, 0, -26],
  ],
  // behind the games card's top-left corner; down the form's right margin; under the form, at its left
  support: [
    [1, 1, 0, -18, 1, 0, -21],
    [1, 2, 0, 120, 2, 1, -150],
    [1, 2, 1, -212, 2, 0, -26],
  ],
  // under the form card, at its right; down the company card's right margin; under it, at its left
  contact: [
    [3, 0, 1, -233, 0, 1, -150],
    [2, 1, 0, 100, 1, 1, -150],
    [3, 1, 1, -233, 1, 0, -26],
  ],
  // under the overview card; across the feature card's bottom edge and among the tiles; across the gap between the
  // app windows; down the compatibility card's right margin; under the how-to card; under the trial card
  'midi-control': [
    [3, 0, 1, -233, 0, 1, -150],
    [1, 1, 1, -109, 1, 0, -19],
    [1, 1, 1, 230, 1, 1, -181],
    [1, 2, 1, -125, 2, 0, -18],
    [2, 4, 0, 60, 4, 1, -150],
    [1, 5, 1, -200, 5, 0, -20],
    [3, 6, 1, -233, 6, 1, -150],
  ],
  // across the gap under the first contact card; under the second; down the questions card's left margin; under it
  'midi-support': [
    [3, 0, 1, -90, 0, 0, -21],
    [3, 1, 1, -233, 1, 1, -150],
    [2, 2, 0, 300, 2, 0, -20],
    [1, 2, 1, -212, 2, 1, -150],
  ],
  // beside every section: under or along each card, alternating sides
  privacy: [
    [3, 0, 1, -233, 0, 1, -150],
    [2, 1, 0, 40, 1, 0, -20],
    [1, 2, 0, 80, 2, 1, -150],
    [3, 3, 1, -233, 3, 0, -26],
    [1, 4, 0, 60, 4, 1, -150],
    [1, 5, 0, 60, 5, 0, -20],
    [3, 6, 1, -233, 6, 1, -150],
  ],
};

/** The page's phone pins, or none where the script searches. */
export const phonePinsOf = (name: PageName): PhonePins | undefined => PHONE_PINS[name];

/** The page's pins in its language, or none where the script searches. */
export const pinsOf = (name: PageName, locale: Locale): Pins | undefined => HATCH_PINS[name]?.[locale];
