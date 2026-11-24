import { describe, expect, test } from 'bun:test';

import { detectConflicts, type Session } from './conflicts.ts';
import type { BusyInterval } from './types.ts';
import { uidForBooking } from './uid.ts';
import { zoned } from './zone.ts';

const at = (day: number, hour: number, minute = 0): number => zoned(2026, 11, day, hour, minute, 'Europe/Prague');
const session = (bookingId: string, day: number, from: number, to: number): Session => ({ bookingId, start: at(day, from), end: at(day, to) });
const entry = (eventId: string | undefined, day: number, from: number, to: number): BusyInterval => ({
  start: at(day, from),
  end: at(day, to),
  allDay: false,
  ...(eventId === undefined ? {} : { eventId }),
});

describe('conflict detection', () => {
  const sessions = [session('a', 24, 10, 14), session('b', 25, 10, 14)];

  test('a rehearsal written over a paid session is reported, with the session it hits', () => {
    const rehearsal = entry('rehearsal-1', 24, 13, 16);
    const conflicts = detectConflicts(sessions, [entry(uidForBooking('a'), 24, 10, 14), entry(uidForBooking('b'), 25, 10, 14), rehearsal]);
    expect(conflicts).toEqual([{ session: sessions[0] as Session, foreign: [rehearsal] }]);
  });

  test('our own events are never a conflict, whichever booking they belong to', () => {
    const own = [entry(uidForBooking('a'), 24, 10, 14), entry(uidForBooking('c'), 24, 12, 13)];
    expect(detectConflicts(sessions, own)).toEqual([]);
  });

  test('an entry that only touches the session does not overlap it', () => {
    expect(detectConflicts(sessions, [entry('before', 24, 8, 10), entry('after', 24, 14, 18)])).toEqual([]);
  });

  test('every overlapping entry is listed, by start; an all-day one too', () => {
    const allDay: BusyInterval = { start: at(25, 0), end: at(26, 0), allDay: true, eventId: 'closed' };
    const late = entry('late', 25, 13, 15);
    const early = entry('early', 25, 9, 11);
    const conflicts = detectConflicts(sessions, [late, allDay, early]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.session.bookingId).toBe('b');
    expect(conflicts[0]?.foreign.map((f) => f.eventId)).toEqual(['closed', 'early', 'late']);
  });

  test('an entry without an id cannot be ours', () => {
    expect(detectConflicts(sessions, [entry(undefined, 24, 10, 14)])).toHaveLength(1);
  });

  test('the caller may say what is ours', () => {
    const mine = (id: string | undefined): boolean => id === 'mine';
    expect(detectConflicts(sessions, [entry('mine', 24, 10, 14)], mine)).toEqual([]);
    expect(detectConflicts(sessions, [entry(uidForBooking('a'), 24, 10, 14)], mine)).toHaveLength(1);
  });

  test('nothing in, nothing out', () => {
    expect(detectConflicts([], [entry('x', 24, 10, 14)])).toEqual([]);
    expect(detectConflicts(sessions, [])).toEqual([]);
  });
});
