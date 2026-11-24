// The studio's wall clock. Bookings are stored as instants (epoch milliseconds); the settings and the customer
// speak in wall-clock times of the studio's time zone (Europe/Prague). The conversion asks `Intl` for the zone's
// offset at the instant in question, so summer time is followed without a fixed offset anywhere.

/** A calendar day on the studio's wall clock: `YYYY-MM-DD`. */
export type LocalDate = string;

/** A time of day on the studio's wall clock: `HH:MM`, from `00:00` to `24:00`. */
export type WallTime = string;

/** ISO weekday: 1 is Monday, 7 is Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The wall clock at an instant, as the UTC timestamp that would show the same date and time. */
function wallAsUtc(instant: number, timeZone: string): number {
  const part: Record<string, number> = {};
  for (const { type, value } of formatter(timeZone).formatToParts(instant)) part[type] = Number(value);
  return Date.UTC(part.year ?? 0, (part.month ?? 1) - 1, part.day ?? 1, part.hour ?? 0, part.minute ?? 0, part.second ?? 0);
}

/** How far the zone's wall clock is ahead of UTC at an instant, in milliseconds. */
export function offsetAt(instant: number, timeZone: string): number {
  return wallAsUtc(instant, timeZone) - Math.floor(instant / 1000) * 1000;
}

/** Whether a string is a real calendar day written `YYYY-MM-DD` (`2026-02-30` is not). */
export function isLocalDate(s: string): boolean {
  const m = DATE.exec(s);
  if (!m) return false;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toISOString().slice(0, 10) === s;
}

/** The day as a UTC midnight: a plain day counter, with no time zone in it. */
function dayNumber(date: LocalDate): number {
  if (!isLocalDate(date)) throw new RangeError(`Not a date: ${date}`);
  return Date.parse(`${date}T00:00:00Z`);
}

/** Whether a string is a time of day written `HH:MM`, up to `24:00`. */
export function isWallTime(s: string): boolean {
  const m = TIME.exec(s);
  if (!m) return false;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[2]) < 60 && minutes <= 24 * 60;
}

/** A time of day as minutes after midnight. Throws on anything that is not `HH:MM`. */
export function minutesOf(time: WallTime): number {
  if (!isWallTime(time)) throw new RangeError(`Not a time of day: ${time}`);
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

/**
 * The instant at which the zone's wall clock shows `minutes` after midnight on `date`.
 *
 * The two odd hours of the year are outside the studio's opening hours, but they are defined: a time skipped by
 * the spring change (02:30 on the last Sunday of March) is read as the same time an hour later on the clock
 * (03:30), and a time that occurs twice in autumn is read as its second occurrence (winter time).
 */
export function instantOf(date: LocalDate, minutes: number, timeZone: string): number {
  const wall = dayNumber(date) + minutes * MINUTE;
  // The offset is first read at the wall time taken as UTC, which is at most hours off; reading it again at the
  // instant that gives settles the days on which the offset changes.
  const guess = wall - offsetAt(wall, timeZone);
  return wall - offsetAt(guess, timeZone);
}

/** The day the zone's wall clock shows at an instant. */
export function localDateOf(instant: number, timeZone: string): LocalDate {
  return new Date(wallAsUtc(instant, timeZone)).toISOString().slice(0, 10);
}

/** The minutes after midnight the zone's wall clock shows at an instant. */
export function wallMinutesOf(instant: number, timeZone: string): number {
  const wall = wallAsUtc(instant, timeZone);
  return Math.floor((((wall % DAY) + DAY) % DAY) / MINUTE);
}

export function weekdayOf(date: LocalDate): Weekday {
  const day = new Date(dayNumber(date)).getUTCDay();
  return (day === 0 ? 7 : day) as Weekday;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return new Date(dayNumber(date) + days * DAY).toISOString().slice(0, 10);
}

/** Every day from `from` to `to`, both included; none when `to` is earlier. */
export function datesBetween(from: LocalDate, to: LocalDate): LocalDate[] {
  const dates: LocalDate[] = [];
  const last = dayNumber(to);
  for (let day = dayNumber(from); day <= last; day += DAY) dates.push(new Date(day).toISOString().slice(0, 10));
  return dates;
}
