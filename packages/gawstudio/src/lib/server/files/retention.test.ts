import { describe, expect, test } from 'bun:test';

import type { UploadRecord } from './plan.ts';
import { deletionPlan, expiresAt, isExpired, lastDay, reminderAt } from './retention.ts';
import { DEFAULT_FILE_SETTINGS } from './settings.ts';

// 30 days, a reminder 5 days before at 9:00, Europe/Prague: UTC+1 in winter, UTC+2 from the last Sunday of March
// (2026-03-29, 2027-03-28) to the last Sunday of October (2026-10-25).
const settings = DEFAULT_FILE_SETTINGS;
const at = (iso: string) => new Date(iso);

describe('retention dates', () => {
  test('in winter: 30 calendar days, to the end of the last day', () => {
    const delivered = at('2026-11-24T14:30:00Z');
    expect(lastDay(delivered, settings)).toBe('2026-12-24');
    expect(expiresAt(delivered, settings)).toEqual(at('2026-12-24T23:00:00Z'));
    expect(reminderAt(delivered, settings)).toEqual(at('2026-12-19T08:00:00Z'));
  });

  test('the local date of delivery counts, not the UTC one', () => {
    // 23:30 UTC on the 24th is already the 25th in Prague.
    expect(lastDay(at('2026-11-24T23:30:00Z'), settings)).toBe('2026-12-25');
    expect(lastDay(at('2026-11-24T22:59:59Z'), settings)).toBe('2026-12-24');
    // 22:30 UTC in summer is past midnight too.
    expect(lastDay(at('2026-07-01T22:30:00Z'), settings)).toBe('2026-08-01');
  });

  test('across the change to summer time: the period is an hour shorter, the dates hold', () => {
    const delivered = at('2026-03-10T11:00:00Z');
    expect(lastDay(delivered, settings)).toBe('2026-04-09');
    expect(expiresAt(delivered, settings)).toEqual(at('2026-04-09T22:00:00Z'));
    // The reminder falls after the change (4 April), at 9:00 summer time.
    expect(reminderAt(delivered, settings)).toEqual(at('2026-04-04T07:00:00Z'));
  });

  test('across the change back to winter time: an hour longer', () => {
    const delivered = at('2026-10-01T08:00:00Z');
    expect(lastDay(delivered, settings)).toBe('2026-10-31');
    expect(expiresAt(delivered, settings)).toEqual(at('2026-10-31T23:00:00Z'));
    // The reminder is on 26 October, the day after the change.
    expect(reminderAt(delivered, settings)).toEqual(at('2026-10-26T08:00:00Z'));
    // One on the day before the change is still in summer time.
    expect(reminderAt(at('2026-09-30T08:00:00Z'), settings)).toEqual(at('2026-10-25T08:00:00Z'));
    expect(reminderAt(at('2026-09-29T08:00:00Z'), settings)).toEqual(at('2026-10-24T07:00:00Z'));
  });

  test('the last day is the day of a change', () => {
    // Delivered 27 February 2027: the last day is 29 March, the day after clocks go forward; and one ending on the 28th.
    expect(expiresAt(at('2027-02-26T12:00:00Z'), settings)).toEqual(at('2027-03-28T22:00:00Z'));
    expect(lastDay(at('2027-02-26T12:00:00Z'), settings)).toBe('2027-03-28');
    expect(expiresAt(at('2027-02-25T12:00:00Z'), settings)).toEqual(at('2027-03-27T23:00:00Z'));
    // Ending on 25 October 2026, the 25-hour day: it ends at midnight winter time.
    expect(expiresAt(at('2026-09-25T12:00:00Z'), settings)).toEqual(at('2026-10-25T23:00:00Z'));
    expect(expiresAt(at('2026-09-24T12:00:00Z'), settings)).toEqual(at('2026-10-24T22:00:00Z'));
  });

  test('over the end of a year and a leap day', () => {
    expect(lastDay(at('2027-12-15T12:00:00Z'), settings)).toBe('2028-01-14');
    expect(lastDay(at('2028-02-10T12:00:00Z'), settings)).toBe('2028-03-11');
  });

  test('the period and the zone are settings', () => {
    const delivered = at('2026-11-24T14:30:00Z');
    expect(lastDay(delivered, { ...settings, retentionDays: 7 })).toBe('2026-12-01');
    expect(expiresAt(delivered, { ...settings, timeZone: 'UTC' })).toEqual(at('2026-12-25T00:00:00Z'));
    expect(reminderAt(delivered, { ...settings, reminderDays: 3, reminderHour: 18 })).toEqual(at('2026-12-21T17:00:00Z'));
  });

  test('no reminder when it would not come after the delivery', () => {
    const delivered = at('2026-11-24T14:30:00Z');
    expect(reminderAt(delivered, { ...settings, retentionDays: 5 })).toBeUndefined();
    expect(reminderAt(delivered, { ...settings, retentionDays: 3 })).toBeUndefined();
    expect(reminderAt(delivered, { ...settings, retentionDays: 6 })).toEqual(at('2026-11-25T08:00:00Z'));
  });

  test('expired from the end of the last day on', () => {
    const delivered = at('2026-11-24T14:30:00Z');
    expect(isExpired(delivered, settings, at('2026-12-24T22:59:59Z'))).toBe(false);
    expect(isExpired(delivered, settings, at('2026-12-24T23:00:00Z'))).toBe(true);
  });
});

describe('what to delete', () => {
  const record = (orderId: string, fileId: string, state: UploadRecord['state'], kind = 'sources') => ({
    orderId,
    state,
    key: `orders/${orderId}/${kind}/t1/${fileId}/a.wav`,
    uploadId: `up-${fileId}`,
  });

  test('completed objects are deleted, unfinished uploads aborted, the rest left alone', () => {
    const records = [
      record('o1', 'f1', 'completed'),
      record('o1', 'f2', 'completed', 'results'),
      record('o1', 'f3', 'uploading'),
      record('o1', 'f4', 'initiated', 'results'),
      record('o1', 'f5', 'aborted'),
      record('o2', 'f6', 'completed'),
      // A record whose key is not under its order is never touched.
      { ...record('o1', 'f7', 'completed'), key: 'orders/o2/sources/t1/f7/a.wav' },
    ];
    expect(deletionPlan('o1', records)).toEqual({
      prefixes: ['orders/o1/sources/', 'orders/o1/results/'],
      objects: ['orders/o1/sources/t1/f1/a.wav', 'orders/o1/results/t1/f2/a.wav'],
      uploads: [
        { key: 'orders/o1/sources/t1/f3/a.wav', uploadId: 'up-f3' },
        { key: 'orders/o1/results/t1/f4/a.wav', uploadId: 'up-f4' },
      ],
    });
  });

  test('an order without files', () => {
    expect(deletionPlan('o9', [])).toEqual({ prefixes: ['orders/o9/sources/', 'orders/o9/results/'], objects: [], uploads: [] });
    expect(() => deletionPlan('../o1', [])).toThrow(RangeError);
  });
});
