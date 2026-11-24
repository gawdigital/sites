import { describe, expect, test } from 'bun:test';

import { detectConflicts } from './conflicts.ts';
import { FakeCalendar } from './fake.ts';
import { CalendarError, type CalendarProvider, type CalendarRef, type StudioEvent } from './types.ts';
import { uidForBooking } from './uid.ts';
import { zoned } from './zone.ts';

const at = (day: number, hour: number): number => zoned(2026, 11, day, hour, 0, 'Europe/Prague');
const studio: CalendarRef = { id: 'studio', ours: true };
const personal: CalendarRef = { id: 'technician-personal', ours: false };
const session: StudioEvent = { bookingId: 'b1', start: at(24, 10), end: at(24, 14), summary: 'Recording' };

async function kindOf(action: Promise<unknown>): Promise<string> {
  try {
    await action;
    return 'none';
  } catch (error) {
    return error instanceof CalendarError ? error.kind : 'other';
  }
}

describe('the in-memory calendar', () => {
  test('is a calendar provider', () => {
    const provider: CalendarProvider = new FakeCalendar({ hasPush: true });
    expect(provider.capabilities).toEqual({ canWrite: true, hasPush: true });
  });

  test('reads back what was written, under the booking’s UID', async () => {
    const fake = new FakeCalendar();
    expect(await fake.write(studio, session)).toEqual({ eventId: uidForBooking('b1'), created: true, etag: '"1"' });
    const reading = await fake.busy(studio, at(24, 0), at(25, 0));
    expect(reading).toEqual({ intervals: [{ start: session.start, end: session.end, allDay: false, eventId: uidForBooking('b1') }], problems: [] });
    expect((await fake.busy(studio, at(25, 0), at(26, 0))).intervals).toEqual([]);
  });

  test('writing the same booking twice keeps one event', async () => {
    const fake = new FakeCalendar();
    await fake.write(studio, session);
    const again = await fake.write(studio, { ...session, end: at(24, 15) });
    expect(again.created).toBe(false);
    expect(fake.written('studio')).toEqual([{ ...session, end: at(24, 15) }]);
  });

  test('update needs the event, and the right version when one is given', async () => {
    const fake = new FakeCalendar();
    expect(await kindOf(fake.update(studio, session))).toBe('not-found');
    const { etag } = await fake.write(studio, session);
    expect(await kindOf(fake.update(studio, session, '"0"'))).toBe('conflict');
    expect((await fake.update(studio, session, etag)).etag).toBe('"2"');
  });

  test('remove is harmless twice', async () => {
    const fake = new FakeCalendar();
    await fake.write(studio, session);
    expect(await fake.remove(studio, 'b1')).toEqual({ removed: true });
    expect(await fake.remove(studio, 'b1')).toEqual({ removed: false });
  });

  test('personal calendars are never written', async () => {
    const fake = new FakeCalendar();
    expect(await kindOf(fake.write(personal, session))).toBe('read-only');
    expect(await kindOf(fake.update(personal, session))).toBe('read-only');
    expect(await kindOf(fake.remove(personal, 'b1'))).toBe('read-only');
    expect(await kindOf(new FakeCalendar({ canWrite: false }).write(studio, session))).toBe('read-only');
  });

  test('foreign entries and problems can be staged, and feed conflict detection', async () => {
    const fake = new FakeCalendar();
    await fake.write(studio, session);
    fake.addForeign('studio', { start: at(24, 13), end: at(24, 17), eventId: 'rehearsal' });
    fake.addForeign('studio', { start: at(26, 0), end: at(27, 0), allDay: true });
    fake.setProblems('studio', [{ kind: 'unsupported-recurrence', eventId: 'x', rule: 'FREQ=MONTHLY;BYDAY=1MO', reason: 'test' }]);

    const reading = await fake.busy(studio, at(24, 0), at(25, 0));
    expect(reading.intervals.map((i) => i.eventId)).toEqual([uidForBooking('b1'), 'rehearsal']);
    expect(reading.problems).toHaveLength(1);
    expect(detectConflicts([session], reading.intervals).map((c) => c.foreign[0]?.eventId)).toEqual(['rehearsal']);

    fake.removeForeign('studio', 'rehearsal');
    expect(detectConflicts([session], (await fake.busy(studio, at(24, 0), at(25, 0))).intervals)).toEqual([]);
    expect(fake.calls).toEqual(['write studio b1', 'busy studio', 'busy studio']);
  });
});
