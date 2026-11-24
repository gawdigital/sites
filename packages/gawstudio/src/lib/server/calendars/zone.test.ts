import { describe, expect, test } from 'bun:test';

import { HOUR, instantToWall, offsetAt, resolveZone, wall, wallToInstant, zoned } from './zone.ts';

const PRAGUE = 'Europe/Prague';

describe('offsets come from Intl', () => {
  test('Prague is an hour ahead in winter and two in summer', () => {
    expect(offsetAt(Date.UTC(2026, 0, 15, 12), PRAGUE)).toBe(HOUR);
    expect(offsetAt(Date.UTC(2026, 6, 15, 12), PRAGUE)).toBe(2 * HOUR);
    expect(offsetAt(Date.UTC(2026, 6, 15, 12), 'UTC')).toBe(0);
  });

  test('the change happens at 01:00 UTC on the last Sunday of March and of October', () => {
    expect(offsetAt(Date.UTC(2026, 2, 29, 0, 59, 59), PRAGUE)).toBe(HOUR);
    expect(offsetAt(Date.UTC(2026, 2, 29, 1), PRAGUE)).toBe(2 * HOUR);
    expect(offsetAt(Date.UTC(2026, 9, 25, 0, 59, 59), PRAGUE)).toBe(2 * HOUR);
    expect(offsetAt(Date.UTC(2026, 9, 25, 1), PRAGUE)).toBe(HOUR);
  });
});

describe('a wall-clock reading becomes an instant', () => {
  test('on an ordinary day, and back', () => {
    const instant = zoned(2026, 11, 24, 18, 0, PRAGUE);
    expect(instant).toBe(Date.UTC(2026, 10, 24, 17));
    expect(instantToWall(instant, PRAGUE)).toBe(wall(2026, 11, 24, 18));
  });

  test('midnight of the days the clocks change', () => {
    expect(zoned(2026, 3, 29, 0, 0, PRAGUE)).toBe(Date.UTC(2026, 2, 28, 23));
    expect(zoned(2026, 3, 30, 0, 0, PRAGUE)).toBe(Date.UTC(2026, 2, 29, 22));
    expect(zoned(2026, 10, 25, 0, 0, PRAGUE)).toBe(Date.UTC(2026, 9, 24, 22));
    expect(zoned(2026, 10, 26, 0, 0, PRAGUE)).toBe(Date.UTC(2026, 9, 25, 23));
  });

  test('a reading that never happens is taken with the offset from before the gap', () => {
    // 02:30 on 29 March does not exist in Prague: it reads as 03:30 summer time.
    expect(zoned(2026, 3, 29, 2, 30, PRAGUE)).toBe(Date.UTC(2026, 2, 29, 1, 30));
  });

  test('a reading that happens twice is the first one', () => {
    // 02:30 on 25 October happens in summer time, then again in winter time.
    expect(zoned(2026, 10, 25, 2, 30, PRAGUE)).toBe(Date.UTC(2026, 9, 25, 0, 30));
    expect(zoned(2026, 10, 25, 3, 0, PRAGUE)).toBe(Date.UTC(2026, 9, 25, 2));
  });

  test('UTC needs no conversion', () => {
    expect(wallToInstant(wall(2026, 3, 29, 2, 30), 'UTC')).toBe(Date.UTC(2026, 2, 29, 2, 30));
  });
});

describe('time zone ids', () => {
  test('IANA ids resolve, in any of the usual spellings', () => {
    expect(resolveZone('Europe/Prague')).toBe('Europe/Prague');
    expect(resolveZone('America/New_York')).toBe('America/New_York');
    expect(resolveZone('America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
    expect(resolveZone('UTC')).toBe('UTC');
    expect(resolveZone('Etc/UTC')).toBe('UTC');
    expect(resolveZone('/freeassociation.sourceforge.net/Europe/Prague')).toBe('Europe/Prague');
  });

  test('anything else does not', () => {
    expect(resolveZone('Central Europe Standard Time')).toBeUndefined();
    expect(resolveZone('Mars/Olympus_Mons')).toBeUndefined();
    expect(resolveZone('')).toBeUndefined();
  });
});
