import { describe, expect, test } from 'bun:test';

import { addDays, datesBetween, instantOf, isLocalDate, isWallTime, localDateOf, minutesOf, offsetAt, wallMinutesOf, weekdayOf } from './time.ts';

const PRAGUE = 'Europe/Prague';
const HOUR = 3_600_000;
const iso = (instant: number): string => new Date(instant).toISOString();

describe('reading dates and times', () => {
  test('a date is a real day written YYYY-MM-DD', () => {
    expect(isLocalDate('2026-02-28')).toBe(true);
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('2026-2-3')).toBe(false);
  });

  test('a time of day runs from 00:00 to 24:00', () => {
    expect(minutesOf('09:30')).toBe(570);
    expect(minutesOf('24:00')).toBe(1440);
    expect(isWallTime('24:30')).toBe(false);
    expect(isWallTime('12:60')).toBe(false);
    expect(isWallTime('9:00')).toBe(false);
    expect(() => minutesOf('noon')).toThrow(RangeError);
  });

  test('weekdays count from Monday', () => {
    expect(weekdayOf('2026-06-01')).toBe(1);
    expect(weekdayOf('2026-03-29')).toBe(7);
  });

  test('days are added and listed across months and clock changes', () => {
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(datesBetween('2026-10-24', '2026-10-26')).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
    expect(datesBetween('2026-06-02', '2026-06-01')).toEqual([]);
    expect(() => datesBetween('2026-06-01', 'tomorrow')).toThrow(RangeError);
  });
});

describe('the Prague wall clock', () => {
  test('winter is an hour ahead of UTC, summer two', () => {
    expect(offsetAt(Date.parse('2026-01-15T12:00:00Z'), PRAGUE)).toBe(HOUR);
    expect(offsetAt(Date.parse('2026-07-15T12:00:00Z'), PRAGUE)).toBe(2 * HOUR);
    expect(iso(instantOf('2026-01-15', 540, PRAGUE))).toBe('2026-01-15T08:00:00.000Z');
    expect(iso(instantOf('2026-07-15', 540, PRAGUE))).toBe('2026-07-15T07:00:00.000Z');
  });

  test('an instant reads back as its day and time', () => {
    const instant = Date.parse('2026-07-15T22:30:00Z');
    expect(localDateOf(instant, PRAGUE)).toBe('2026-07-16');
    expect(wallMinutesOf(instant, PRAGUE)).toBe(30);
    expect(wallMinutesOf(Date.parse('2026-01-15T23:00:00Z'), PRAGUE)).toBe(0);
  });

  test('the last Sunday of March has 23 hours, and the studio hours are in summer time', () => {
    expect(instantOf('2026-03-30', 0, PRAGUE) - instantOf('2026-03-29', 0, PRAGUE)).toBe(23 * HOUR);
    expect(iso(instantOf('2026-03-28', 540, PRAGUE))).toBe('2026-03-28T08:00:00.000Z');
    expect(iso(instantOf('2026-03-29', 540, PRAGUE))).toBe('2026-03-29T07:00:00.000Z');
    expect(iso(instantOf('2026-03-29', 23 * 60, PRAGUE))).toBe('2026-03-29T21:00:00.000Z');
    expect(iso(instantOf('2026-03-29', 90, PRAGUE))).toBe('2026-03-29T00:30:00.000Z');
    expect(iso(instantOf('2026-03-29', 24 * 60, PRAGUE))).toBe('2026-03-29T22:00:00.000Z');
  });

  test('a time the spring change skips is read an hour later on the clock', () => {
    const skipped = instantOf('2026-03-29', 150, PRAGUE);
    expect(iso(skipped)).toBe('2026-03-29T01:30:00.000Z');
    expect(wallMinutesOf(skipped, PRAGUE)).toBe(210);
  });

  test('the last Sunday of October has 25 hours, and the studio hours are in winter time', () => {
    expect(instantOf('2026-10-26', 0, PRAGUE) - instantOf('2026-10-25', 0, PRAGUE)).toBe(25 * HOUR);
    expect(iso(instantOf('2026-10-24', 540, PRAGUE))).toBe('2026-10-24T07:00:00.000Z');
    expect(iso(instantOf('2026-10-25', 540, PRAGUE))).toBe('2026-10-25T08:00:00.000Z');
    expect(iso(instantOf('2026-10-25', 90, PRAGUE))).toBe('2026-10-24T23:30:00.000Z');
    expect(iso(instantOf('2026-10-25', 210, PRAGUE))).toBe('2026-10-25T02:30:00.000Z');
  });

  test('a time that occurs twice in autumn is read as the second one', () => {
    expect(iso(instantOf('2026-10-25', 150, PRAGUE))).toBe('2026-10-25T01:30:00.000Z');
  });

  test('every half hour of both change days reads back as itself', () => {
    for (const date of ['2026-03-29', '2026-10-25']) {
      for (let minutes = 180; minutes < 1440; minutes += 30) {
        const instant = instantOf(date, minutes, PRAGUE);
        expect(localDateOf(instant, PRAGUE)).toBe(date);
        expect(wallMinutesOf(instant, PRAGUE)).toBe(minutes);
      }
    }
  });
});
