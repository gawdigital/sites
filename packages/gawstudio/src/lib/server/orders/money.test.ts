import { describe, expect, test } from 'bun:test';

import { formatRate, isCurrency, netOfGross, percentOf, roundDiv } from './money.ts';

describe('rounding', () => {
  test('a half rounds away from zero, in integers', () => {
    expect(roundDiv(5, 10)).toBe(1);
    expect(roundDiv(4, 10)).toBe(0);
    expect(roundDiv(15, 10)).toBe(2);
    expect(roundDiv(-5, 10)).toBe(-1);
    expect(roundDiv(-4, 10)).toBe(-0);
    expect(roundDiv(20, 10)).toBe(2);
  });

  test('a rate of an amount is rounded to the minor unit', () => {
    expect(percentOf(320_000, 2100)).toBe(67_200);
    expect(percentOf(1665, 500)).toBe(83); // 83.25
    expect(percentOf(1670, 500)).toBe(84); // 83.5
    expect(percentOf(95, 2100)).toBe(20); // 19.95
    // 1.15 × 100 is 114.99999999999999 in floats; the integer route does not care.
    expect(percentOf(115, 10_000)).toBe(115);
  });

  test('the net of a gross amount', () => {
    expect(netOfGross(12_100, 2100)).toBe(10_000);
    expect(netOfGross(387_200, 2100)).toBe(320_000);
    expect(netOfGross(100, 2100)).toBe(83); // 82.64
  });
});

describe('currencies and rates', () => {
  test('only CZK and EUR are currencies', () => {
    expect(isCurrency('CZK')).toBe(true);
    expect(isCurrency('EUR')).toBe(true);
    expect(isCurrency('USD')).toBe(false);
  });

  test('a rate reads as a percentage', () => {
    expect(formatRate(2100)).toBe('21 %');
    expect(formatRate(550)).toBe('5.5 %');
  });
});
