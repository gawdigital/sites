import { expect, test } from 'bun:test';

import { LOCALES } from '@gaw/i18n/locale.ts';

import type { HatchPin } from '@gaw/ui/types.ts';

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

// The design's 1440 px frame: the column runs from 120 to 1320, a row of two splits it into 120–690 and 750–1320, and
// its centre line (the gap's centre) is at 720. A group is 361.2 px wide (516 × 0.7), its pills 92.4 px wide at 0,
// 134.4 and 268.8. A group sits on the centre line where one of its pills does, within 24 px; groups follow each other
// down the page in the order of the box and edge they hang from.
const CENTRE = 720;
const PILLS = [0, 134.4, 268.8].map((x) => x + 46.2);
const edgeX = ([, , , , , , xChild, xEdge]: HatchPin) =>
  xChild < 0 ? [120, 1320][xEdge] : [[120, 690], [750, 1320]][xChild]?.[xEdge];
const onCentre = (pin: HatchPin) => PILLS.some((x) => Math.abs((edgeX(pin) ?? NaN) + pin[8] + x - CENTRE) <= 24);
const downThePage = (a: HatchPin, b: HatchPin) => a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[4] - b[4];

test('a pin hangs from the column or one of its two halves', () => {
  for (const pins of Object.values(HATCH_PINS))
    for (const pin of Object.values(pins).flat()) expect(edgeX(pin)).toBeNumber();
});

test('no two groups in a row sit on the centre line, one under the other', () => {
  for (const [name, pins] of Object.entries(HATCH_PINS))
    for (const locale of LOCALES) {
      const centred = [...(pins[locale] ?? [])].sort(downThePage).map(onCentre);
      for (let i = 1; i < centred.length; i++)
        expect(centred[i - 1] && centred[i], `${name} (${locale}), groups ${i} and ${i + 1}`).toBeFalse();
    }
});

test('the privacy groups under the third and fourth rows stay off the centre line', () => {
  for (const locale of LOCALES)
    expect((pinsOf('privacy', locale) ?? []).filter((pin) => pin[3] === 1 && pin[1] >= 3).map(onCentre)).toEqual([
      false,
      false,
    ]);
});
