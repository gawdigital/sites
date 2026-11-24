// What every calendar provider offers the booking system, whichever service is behind it (iCloud over CalDAV,
// Google Calendar, an in-memory fake; Outlook or another can be added by implementing `CalendarProvider`).
// Instants are epoch milliseconds throughout; the studio's wall clock is Europe/Prague.

/** The studio's wall clock: floating times and all-day events are read in it. */
export const STUDIO_ZONE = 'Europe/Prague';

/**
 * One calendar at a provider. `id` is whatever the provider addresses it by (a CalDAV collection URL, a Google
 * calendar id). `ours` marks the studio's own calendars (the shared studio calendar, and one per technician that
 * they subscribe to): the only ones ever written. A technician's personal calendar is `ours: false` and is only
 * read, and only for busy times.
 */
export interface CalendarRef {
  id: string;
  ours: boolean;
}

/** A stretch of time something occupies: `[start, end)`. */
export interface BusyInterval {
  start: number;
  end: number;
  /** An all-day entry, already resolved to Prague midnight-to-midnight. */
  allDay: boolean;
  /**
   * The entry's identity where the provider gives one: the iCalendar UID over CalDAV (so our own events are
   * recognisable with `isOurUid`), absent from Google's free/busy answers. Opaque otherwise.
   */
  eventId?: string;
}

/**
 * What could not be read as busy time. Never dropped silently: the caller reports these (to the studio's owner),
 * since a calendar that cannot be read in full cannot vouch that a slot is free.
 */
export type BusyProblem =
  /** A recurrence this reader does not expand; only the event's first occurrence was counted. */
  | { kind: 'unsupported-recurrence'; eventId?: string; rule: string; reason: string }
  /** An event without a usable start (or in a time zone Intl does not know); it was not counted at all. */
  | { kind: 'unreadable-event'; eventId?: string; reason: string }
  /** The provider could not answer for this calendar (Google's per-calendar `errors`). */
  | { kind: 'unavailable'; reason: string };

export interface BusyReading {
  /** Sorted by start. Not merged: each entry keeps its identity. */
  intervals: BusyInterval[];
  problems: BusyProblem[];
}

/** An event the booking system puts into one of the studio's own calendars: a confirmed recording session. */
export interface StudioEvent {
  /** Our booking's id; the event's UID is derived from it (`uidForBooking`), which makes writes idempotent. */
  bookingId: string;
  start: number;
  end: number;
  summary: string;
  description?: string;
  location?: string;
}

export interface WriteResult {
  /** The provider's id for the event: the UID over CalDAV, the event id at Google. */
  eventId: string;
  /** Whether this call created the event (`false`: it was there already and now holds the given content). */
  created: boolean;
  /** The version tag to pass to `update`/`remove` for an optimistic check, where the provider returns one. */
  etag?: string;
}

export interface Capabilities {
  /** Whether `write`/`update`/`remove` work at all (on `ours` calendars). */
  canWrite: boolean;
  /** Whether changes can be pushed to us (Google's watch channels); otherwise the calendar is polled. */
  hasPush: boolean;
}

export interface CalendarProvider {
  readonly name: string;
  readonly capabilities: Capabilities;
  /** Everything that occupies the calendar within `[from, to)`. */
  busy(calendar: CalendarRef, from: number, to: number): Promise<BusyReading>;
  /** Puts the event into the calendar: creates it, or brings the existing one (same booking) to this content. */
  write(calendar: CalendarRef, event: StudioEvent): Promise<WriteResult>;
  /** Changes an event that must exist; with `etag`, only if it is still that version. */
  update(calendar: CalendarRef, event: StudioEvent, etag?: string): Promise<WriteResult>;
  /** Removes the booking's event; `removed: false` when it was not there (so removing twice is harmless). */
  remove(calendar: CalendarRef, bookingId: string, etag?: string): Promise<{ removed: boolean }>;
}

export type CalendarErrorKind =
  /** The credentials were refused (a revoked app-specific password, an expired token). */
  | 'auth'
  /** The calendar or the event is not there. */
  | 'not-found'
  /** The event changed since the given `etag`. */
  | 'conflict'
  /** A write to a calendar that is not the studio's own, or at a provider that cannot write. */
  | 'read-only'
  /** Any other HTTP failure; `status` says which. */
  | 'http'
  /** An answer that could not be understood, or a redirect we refuse to follow. */
  | 'protocol';

export class CalendarError extends Error {
  readonly kind: CalendarErrorKind;
  readonly status?: number;

  constructor(kind: CalendarErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'CalendarError';
    this.kind = kind;
    this.status = status;
  }
}

/** Refuses a write anywhere but the studio's own calendars: personal calendars are never touched. */
export function assertOurs(calendar: CalendarRef): void {
  if (!calendar.ours) throw new CalendarError('read-only', 'Only the studio’s own calendars are written.');
}

/** Whether `[aStart, aEnd)` and `[bStart, bEnd)` share any time; touching ends do not overlap. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function byStart(a: BusyInterval, b: BusyInterval): number {
  return a.start - b.start || a.end - b.end;
}
