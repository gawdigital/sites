// What the tests share: instants written as the studio's wall clock, and slots read back the same way.
import type { Busy, BusyKind, Interval, Slot } from './availability.ts';
import { DEFAULT_SETTINGS } from './settings.ts';
import { instantOf, minutesOf, wallMinutesOf } from './time.ts';
import type { LocalDate, WallTime } from './time.ts';

const ZONE = DEFAULT_SETTINGS.timeZone;

/** The instant of a wall-clock time in Prague. */
export const at = (date: LocalDate, time: WallTime): number => instantOf(date, minutesOf(time), ZONE);

export const between = (date: LocalDate, start: WallTime, end: WallTime): Interval => ({ start: at(date, start), end: at(date, end) });

export const busy = (kind: BusyKind, date: LocalDate, start: WallTime, end: WallTime): Busy => ({ ...between(date, start, end), kind });

const clock = (instant: number): string => {
  const minutes = wallMinutesOf(instant, ZONE);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

/** An interval as `09:00-13:00` on the Prague wall clock. */
export const span = (interval: Interval): string => `${clock(interval.start)}-${clock(interval.end)}`;

/** Slots as `block 09:00-13:00`. */
export const spans = (slots: readonly Slot[]): string[] => slots.map((slot) => `${slot.kind} ${span(slot)}`);
