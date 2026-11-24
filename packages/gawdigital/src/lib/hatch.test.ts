import { expect, test } from 'bun:test';

import { LOCALES } from '@gaw/i18n/locale.ts';

import { HATCH_PINS, PHONE_PINS, phonePinsOf, pinsOf } from './hatch.ts';

test('every pinned page has its own pins in every language', () => {
  for (const pins of Object.values(HATCH_PINS)) for (const locale of LOCALES) expect(pins[locale]?.length).toBeGreaterThan(0);
});

test('each language keeps its own arrangement', () => {
  expect(pinsOf('privacy', 'en')?.[0]).toEqual([2, 1, -1, 0, -463, 1, -1, 1, -400]);
  expect(pinsOf('privacy', 'de')).toEqual(pinsOf('privacy', 'en'));
  expect(pinsOf('privacy', 'cs')?.slice(0, 2)).toEqual([
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

test('the privacy cards carry a group under each row of two, in every language', () => {
  for (const locale of LOCALES) {
    const rows = (pinsOf('privacy', locale) ?? []).filter((pin) => pin[3] === 1).map((pin) => pin[1]);
    expect(rows).toContain(3);
    expect(rows).toContain(4);
  }
});

test('every pinned page hangs its phone hatch from its cards', () => {
  for (const name of Object.keys(HATCH_PINS) as (keyof typeof HATCH_PINS)[])
    expect(phonePinsOf(name)?.length).toBeGreaterThan(0);
  expect(phonePinsOf('error')).toBeUndefined();
  for (const pin of Object.values(PHONE_PINS).flat()) {
    expect(pin).toHaveLength(7);
    expect([1, 2, 3]).toContain(pin[0]);
    expect([0, 1]).toContain(pin[2]);
    expect([0, 1]).toContain(pin[5]);
    expect(pin[1]).toBeGreaterThanOrEqual(0);
    expect(pin[4]).toBeGreaterThanOrEqual(0);
  }
});

test('the phone hangs a group under the web card at home and under Cesta', () => {
  expect(phonePinsOf('home')).toContainEqual([3, 2, 1, -235, 2, 1, -200]);
  expect(phonePinsOf('web')).toContainEqual([3, 2, 1, -233, 2, 0, -26]);
});
