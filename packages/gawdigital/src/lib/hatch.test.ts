import { expect, test } from 'bun:test';

import { LOCALES } from '@gaw/i18n/locale.ts';

import { HATCH_PINS, pinsOf } from './hatch.ts';

test('every pinned page has its own pins in every language', () => {
  for (const pins of Object.values(HATCH_PINS)) for (const locale of LOCALES) expect(pins[locale]?.length).toBeGreaterThan(0);
});

test('each language keeps its own arrangement', () => {
  expect(pinsOf('privacy', 'en')).toEqual([[2, 1, -1, 0, -463, 1, -1, 1, -400]]);
  expect(pinsOf('privacy', 'de')).toEqual(pinsOf('privacy', 'en'));
  expect(pinsOf('privacy', 'cs')).toEqual([
    [2, 1, -1, 0, 111, 1, -1, 0, 208],
    [1, 2, -1, 1, -190, 2, -1, 1, -432],
  ]);
  expect(pinsOf('support', 'cs')).toHaveLength(1);
  expect(pinsOf('midi-control', 'cs')).toHaveLength(4);
  expect(pinsOf('midi-control', 'de')?.[4]?.[0]).toBe(3);
});

test('a page without pins leaves its hatch to the search', () => {
  expect(pinsOf('error', 'cs')).toBeUndefined();
});

test('a pin names a known shape and edges', () => {
  for (const pins of Object.values(HATCH_PINS))
    for (const pin of Object.values(pins).flat()) {
      expect([1, 2, 3]).toContain(pin[0]);
      expect([0, 1]).toContain(pin[3]);
      expect([0, 1]).toContain(pin[7]);
    }
});
