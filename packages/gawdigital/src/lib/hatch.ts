import type { Locale } from '@gaw/i18n/locale.ts';
import type { HatchPin } from '@gaw/ui/types.ts';

import type { PageName } from './site.ts';

type Pins = readonly HatchPin[];

// The desktop's background hatch, pinned to the boxes as the design placed it on the 1320 px column: each group keeps
// its offset from the top or bottom edge of the box it hangs from, and from the left or right edge of the box it sits
// beside (where it crosses the gap between two columns, the columns' inner edge, which the narrower column left in
// place). So it holds whatever the column's width. Each language keeps its own arrangement: the design's hatch was
// searched around each language's text, so a page may hang different groups, or the same ones elsewhere, in Czech or
// German. The blocks are `main`'s children that are not dividers. The phone, and pages not listed here, place theirs
// by the script's search.
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
  // edge, at its right
  privacy: {
    en: [[2, 1, -1, 0, -463, 1, -1, 1, -400]],
    cs: [
      [2, 1, -1, 0, 111, 1, -1, 0, 208],
      [1, 2, -1, 1, -190, 2, -1, 1, -432],
    ],
    de: [[2, 1, -1, 0, -463, 1, -1, 1, -400]],
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

/** The page's pins in its language, or none where the script searches. */
export const pinsOf = (name: PageName, locale: Locale): Pins | undefined => HATCH_PINS[name]?.[locale];
