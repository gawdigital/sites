import type { HatchPin } from '@gaw/ui/types.ts';

import type { PageName } from './site.ts';

// The desktop's background hatch, pinned to the boxes as the design placed it on the 1320 px column: each group keeps
// its offset from the top or bottom edge of the box it hangs from, and from the left or right edge of the box it sits
// beside (where it crosses the gap between two columns, the columns' inner edge, which the narrower column left in
// place). So it holds whatever the column's width and in every language. The blocks are `main`'s children that are
// not dividers. The phone, and pages not listed here, place theirs by the script's search.
export const HATCH_PINS: Partial<Record<PageName, readonly HatchPin[]>> = {
  // over the app card's top edge, at its right; under the duo, across the gap between its cards
  home: [
    [1, 1, -1, 0, -360, 1, -1, 1, -431],
    [3, 2, -1, 1, -139, 2, 1, 0, -163],
  ],
  // above the two projects, across their gap; over the partner card's bottom edge
  web: [
    [2, 1, -1, 0, -498, 1, 1, 0, -76],
    [3, 2, -1, 1, -389, 2, -1, 0, 241],
  ],
  // above the right column; under the columns, across their gap
  support: [
    [2, 1, -1, 0, -397, 1, 1, 1, -408],
    [1, 1, -1, 1, -192, 1, 1, 0, -151],
  ],
  // above the company card; under the form, across the columns' gap
  contact: [
    [1, 1, -1, 0, -390, 1, 1, 1, -405],
    [3, 1, 0, 1, -225, 1, 1, 0, -139],
  ],
  // above the first card, at its right
  privacy: [[2, 1, -1, 0, -463, 1, -1, 1, -400]],
  // under the overview card, the features, the app windows and the compatibility card, at the columns' gap; under
  // the trial card, at its right
  'midi-control': [
    [2, 1, -1, 1, -335, 2, 1, 0, -89],
    [1, 2, -1, 1, -154, 2, 0, 1, -392],
    [1, 3, -1, 1, -124, 3, 1, 0, -31],
    [2, 4, -1, 1, -333, 5, 0, 1, -331],
    [2, 5, 1, 1, -471, 5, 1, 1, -448],
  ],
  // above the right card; under the two cards, across their gap; behind the questions' card
  'midi-support': [
    [1, 1, -1, 0, -648, 1, 1, 1, -450],
    [1, 1, -1, 1, -140, 1, 1, 0, -224],
    [1, 2, 0, 1, 139, 2, -1, 0, 507],
  ],
};
