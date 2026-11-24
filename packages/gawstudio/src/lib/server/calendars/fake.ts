// A calendar provider that lives in memory, for the tests of the modules that use calendars (availability,
// booking, the poll). It behaves like the real ones where it matters: writes only into `ours` calendars, our
// events carry the booking's UID, a second write of the same booking changes the event instead of adding one.

import {
  assertOurs,
  type BusyInterval,
  type BusyProblem,
  type BusyReading,
  byStart,
  CalendarError,
  type CalendarProvider,
  type CalendarRef,
  type Capabilities,
  overlaps,
  type StudioEvent,
  type WriteResult,
} from './types.ts';
import { uidForBooking } from './uid.ts';

interface Stored {
  event: StudioEvent;
  version: number;
}

export class FakeCalendar implements CalendarProvider {
  readonly name = 'fake';
  readonly capabilities: Capabilities;
  /** Every call made, in order: `busy <calendar>`, `write <calendar> <bookingId>`, … */
  readonly calls: string[] = [];
  readonly #foreign = new Map<string, BusyInterval[]>();
  readonly #ours = new Map<string, Map<string, Stored>>();
  readonly #problems = new Map<string, BusyProblem[]>();

  constructor(capabilities: Partial<Capabilities> = {}) {
    this.capabilities = { canWrite: true, hasPush: false, ...capabilities };
  }

  /** Puts somebody else's entry into a calendar: a rehearsal, a technician's dentist appointment. */
  addForeign(calendarId: string, entry: { start: number; end: number; allDay?: boolean; eventId?: string }): void {
    const { start, end, allDay = false, eventId } = entry;
    const interval: BusyInterval = { start, end, allDay, ...(eventId === undefined ? {} : { eventId }) };
    this.#foreign.set(calendarId, [...(this.#foreign.get(calendarId) ?? []), interval]);
  }

  /** Takes foreign entries out again: all of a calendar's, or the one with that id. */
  removeForeign(calendarId: string, eventId?: string): void {
    const kept = eventId === undefined ? [] : (this.#foreign.get(calendarId) ?? []).filter((i) => i.eventId !== eventId);
    this.#foreign.set(calendarId, kept);
  }

  /** Makes every reading of a calendar report these problems (an unsupported recurrence, say). */
  setProblems(calendarId: string, problems: BusyProblem[]): void {
    this.#problems.set(calendarId, problems);
  }

  /** The events we wrote into a calendar, by start. */
  written(calendarId: string): StudioEvent[] {
    return [...(this.#ours.get(calendarId)?.values() ?? [])].map((s) => s.event).sort((a, b) => a.start - b.start);
  }

  async busy(calendar: CalendarRef, from: number, to: number): Promise<BusyReading> {
    this.calls.push(`busy ${calendar.id}`);
    const own: BusyInterval[] = [...(this.#ours.get(calendar.id)?.values() ?? [])].map(({ event }) => ({
      start: event.start,
      end: event.end,
      allDay: false,
      eventId: uidForBooking(event.bookingId),
    }));
    const intervals = [...own, ...(this.#foreign.get(calendar.id) ?? [])]
      .filter((i) => overlaps(i.start, i.end, from, to))
      .map((i) => ({ ...i }))
      .sort(byStart);
    return { intervals, problems: [...(this.#problems.get(calendar.id) ?? [])] };
  }

  #writable(calendar: CalendarRef): Map<string, Stored> {
    assertOurs(calendar);
    if (!this.capabilities.canWrite) throw new CalendarError('read-only', 'This provider cannot write.');
    let events = this.#ours.get(calendar.id);
    if (!events) this.#ours.set(calendar.id, (events = new Map()));
    return events;
  }

  #store(events: Map<string, Stored>, event: StudioEvent, created: boolean): WriteResult {
    const version = (events.get(event.bookingId)?.version ?? 0) + 1;
    events.set(event.bookingId, { event: { ...event }, version });
    return { eventId: uidForBooking(event.bookingId), created, etag: `"${version}"` };
  }

  async write(calendar: CalendarRef, event: StudioEvent): Promise<WriteResult> {
    this.calls.push(`write ${calendar.id} ${event.bookingId}`);
    const events = this.#writable(calendar);
    return this.#store(events, event, !events.has(event.bookingId));
  }

  async update(calendar: CalendarRef, event: StudioEvent, etag?: string): Promise<WriteResult> {
    this.calls.push(`update ${calendar.id} ${event.bookingId}`);
    const events = this.#writable(calendar);
    const stored = events.get(event.bookingId);
    if (!stored) throw new CalendarError('not-found', 'There is no such event to update.');
    if (etag !== undefined && etag !== `"${stored.version}"`) throw new CalendarError('conflict', 'The event changed since it was read.');
    return this.#store(events, event, false);
  }

  async remove(calendar: CalendarRef, bookingId: string, etag?: string): Promise<{ removed: boolean }> {
    this.calls.push(`remove ${calendar.id} ${bookingId}`);
    const events = this.#writable(calendar);
    const stored = events.get(bookingId);
    if (!stored) return { removed: false };
    if (etag !== undefined && etag !== `"${stored.version}"`) throw new CalendarError('conflict', 'The event changed since it was read.');
    events.delete(bookingId);
    return { removed: true };
  }
}
