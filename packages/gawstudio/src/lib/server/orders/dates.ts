// Calendar dates for the studio, which works in Prague: a date is a `YYYY-MM-DD` string, an instant is a `Date`.
// Only `Intl` is used, so this runs the same under Bun and on Workers.

export const TIME_ZONE = 'Europe/Prague';

/** A calendar date in Prague, `YYYY-MM-DD`. */
export type CalendarDate = string;

const DAY_MS = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const WALL = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Prague's wall clock at an instant, as if it were UTC: the difference to the instant is the zone's offset. */
function wallClock(instant: Date): number {
  const part: Record<string, number> = {};
  for (const { type, value } of WALL.formatToParts(instant)) part[type] = Number(value);
  return Date.UTC(part.year!, part.month! - 1, part.day!, part.hour!, part.minute!, part.second!);
}

/** A date as UTC midnight, the form the arithmetic below works in; throws on anything but a real `YYYY-MM-DD`. */
function utcMidnight(date: CalendarDate): number {
  const m = DATE.exec(date);
  const ms = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date) throw new RangeError(`Not a calendar date: ${date}`);
  return ms;
}

/** The Prague calendar date an instant falls on. */
export function pragueDate(instant: Date): CalendarDate {
  return new Date(wallClock(instant)).toISOString().slice(0, 10);
}

/** The date `days` calendar days later (earlier when negative). */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  return new Date(utcMidnight(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The ISO weekday: 1 is Monday, 7 is Sunday. */
export function isoWeekday(date: CalendarDate): number {
  return new Date(utcMidnight(date)).getUTCDay() || 7;
}

/** The Monday of the date's week: the key a week is known by. */
export function weekStart(date: CalendarDate): CalendarDate {
  return addDays(date, 1 - isoWeekday(date));
}

/**
 * The instant a Prague day begins. Prague changes its clock at 01:00 UTC, never at local midnight, so the offset
 * found for the first guess is checked once and that settles it.
 */
export function startOfPragueDay(date: CalendarDate): Date {
  const midnight = utcMidnight(date);
  const offset = (at: number) => wallClock(new Date(at)) - at;
  const guess = midnight - offset(midnight);
  return new Date(midnight - offset(guess));
}
