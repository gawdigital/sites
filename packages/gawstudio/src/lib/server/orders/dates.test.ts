import { describe, expect, test } from 'bun:test';

import { addDays, isoWeekday, pragueDate, startOfPragueDay, weekStart } from './dates.ts';

describe('Prague calendar dates', () => {
  test('an instant late in the UTC evening is already the next day in Prague', () => {
    expect(pragueDate(new Date('2026-11-24T22:59:59Z'))).toBe('2026-11-24');
    expect(pragueDate(new Date('2026-11-24T23:00:00Z'))).toBe('2026-11-25');
    // Summer time: two hours ahead.
    expect(pragueDate(new Date('2026-07-01T21:59:59Z'))).toBe('2026-07-01');
    expect(pragueDate(new Date('2026-07-01T22:00:00Z'))).toBe('2026-07-02');
  });

  test('a day begins at Prague midnight, in winter, in summer and on the days the clock changes', () => {
    expect(startOfPragueDay('2026-11-25').toISOString()).toBe('2026-11-24T23:00:00.000Z');
    expect(startOfPragueDay('2026-07-01').toISOString()).toBe('2026-06-30T22:00:00.000Z');
    expect(startOfPragueDay('2026-03-29').toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(startOfPragueDay('2026-03-30').toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(startOfPragueDay('2026-10-25').toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(startOfPragueDay('2026-10-26').toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  test('days add across months, years and leap days', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  test('weekdays are ISO, weeks start on Monday', () => {
    expect(isoWeekday('2026-11-23')).toBe(1);
    expect(isoWeekday('2026-11-24')).toBe(2);
    expect(isoWeekday('2026-11-29')).toBe(7);
    expect(weekStart('2026-11-29')).toBe('2026-11-23');
    expect(weekStart('2026-11-23')).toBe('2026-11-23');
    expect(weekStart('2026-12-02')).toBe('2026-11-30');
  });

  test('what is not a date is refused', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
    expect(() => isoWeekday('24.11.2026')).toThrow(RangeError);
  });
});
