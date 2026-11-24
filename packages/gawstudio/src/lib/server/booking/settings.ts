// What the admin sets about booking recording sessions. Nothing below is logic: the availability and hold code
// reads every time, length and switch from a `BookingSettings` object, and `DEFAULT_SETTINGS` is only what the
// studio starts with.
import { addDays, isLocalDate, isWallTime, minutesOf, weekdayOf } from './time.ts';
import type { LocalDate, WallTime, Weekday } from './time.ts';

/**
 * One fixed block of the day.
 *
 * `validFrom` versions a block: entries that share an `id` are versions of the same block, and on a given day the
 * one with the latest `validFrom` not after that day applies (an entry without `validFrom` has always applied).
 * So new times, days or the online switch can be prepared ahead and take over on their date, and the days before
 * keep what was offered for them.
 */
export interface BlockSetting {
  id: string;
  start: WallTime;
  end: WallTime;
  /** The days of the week the block exists on. */
  weekdays: readonly Weekday[];
  /** Bookable on the site. A block that is switched off is defined, and never offered. */
  online: boolean;
  /** The first studio day this version applies to. */
  validFrom?: LocalDate;
}

export interface BookingSettings {
  /** The zone of every wall-clock time below. */
  timeZone: string;
  blocks: readonly BlockSetting[];
  /** The shortest session: the length of every free window offered on a day broken by a rehearsal. */
  minimumMinutes: number;
  /** Between a calendar entry (a rehearsal) and a recording session, in either direction. */
  rehearsalBufferMinutes: number;
  /** Between two recording sessions (a held slot counts as a session). */
  sessionBufferMinutes: number;
  /** Around a technician's own busy time. */
  technicianBufferMinutes: number;
  /** Free windows start on multiples of this, counted from midnight on the wall clock. */
  stepMinutes: number;
  /** The hours free windows must lie within. */
  windowHours: { start: WallTime; end: WallTime };
  /** Whether all the day's online blocks can be booked at once. */
  wholeDay: boolean;
  /** How long choosing a slot holds it while the customer pays. */
  holdMinutes: number;
  /** A slot is offered only when it starts at least this long after now. */
  leadTimeMinutes: number;
  /** A slot is offered only up to this many days after today (on the studio's wall clock). */
  horizonDays: number;
}

const EVERY_DAY: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/**
 * The studio's starting point. The blocks, the lengths and the buffers are the agreed ones; the hold time, the
 * lead time, the horizon and "every day of the week" are placeholders the owner has not decided yet.
 */
export const DEFAULT_SETTINGS: BookingSettings = {
  timeZone: 'Europe/Prague',
  blocks: [
    { id: 'morning', start: '09:00', end: '13:00', weekdays: EVERY_DAY, online: true },
    { id: 'afternoon', start: '14:00', end: '18:00', weekdays: EVERY_DAY, online: true },
    // Defined, switched off: evenings stay free for rehearsals.
    { id: 'evening', start: '19:00', end: '23:00', weekdays: EVERY_DAY, online: false },
  ],
  minimumMinutes: 240,
  rehearsalBufferMinutes: 30,
  sessionBufferMinutes: 60,
  technicianBufferMinutes: 0,
  stepMinutes: 30,
  windowHours: { start: '09:00', end: '23:00' },
  wholeDay: true,
  holdMinutes: 10,
  leadTimeMinutes: 24 * 60,
  horizonDays: 90,
};

/** A block as it applies on one day: its times as minutes after midnight. */
export interface DayBlock {
  id: string;
  startMinutes: number;
  endMinutes: number;
  online: boolean;
}

/** The blocks that exist on a day, online or not, in the order of their start: the version in force of each. */
export function blocksOn(date: LocalDate, settings: BookingSettings): DayBlock[] {
  const inForce = new Map<string, BlockSetting>();
  for (const block of settings.blocks) {
    const from = block.validFrom ?? '';
    if (from > date) continue;
    const current = inForce.get(block.id);
    // On equal dates the later entry wins, so the result does not depend on a sort.
    if (!current || from >= (current.validFrom ?? '')) inForce.set(block.id, block);
  }
  const weekday = weekdayOf(date);
  return [...inForce.values()]
    .filter((block) => block.weekdays.includes(weekday))
    .map((block) => ({ id: block.id, startMinutes: minutesOf(block.start), endMinutes: minutesOf(block.end), online: block.online }))
    .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);
}

const wholeNumber = (n: number, least: number): boolean => Number.isInteger(n) && n >= least;

function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * What is wrong with a settings object, in plain sentences for the admin; empty when it can be used. The
 * availability code assumes settings that pass: it throws on a time it cannot read.
 */
export function settingsProblems(settings: BookingSettings): string[] {
  const problems: string[] = [];
  if (!isTimeZone(settings.timeZone)) problems.push(`Unknown time zone: ${settings.timeZone}.`);

  const atLeast: [name: string, value: number, least: number][] = [
    ['The minimum length', settings.minimumMinutes, 1],
    ['The step', settings.stepMinutes, 1],
    ['The hold time', settings.holdMinutes, 1],
    ['The buffer around rehearsals', settings.rehearsalBufferMinutes, 0],
    ['The buffer between sessions', settings.sessionBufferMinutes, 0],
    ['The buffer around a technician’s busy time', settings.technicianBufferMinutes, 0],
    ['The lead time', settings.leadTimeMinutes, 0],
    ['The booking horizon', settings.horizonDays, 0],
  ];
  for (const [name, value, least] of atLeast) {
    if (!wholeNumber(value, least)) problems.push(`${name} must be a whole number, at least ${least}.`);
  }

  const { start, end } = settings.windowHours;
  if (!isWallTime(start) || !isWallTime(end)) problems.push('The hours for free windows must be times written HH:MM.');
  else if (minutesOf(end) - minutesOf(start) < settings.minimumMinutes) problems.push('The hours for free windows are shorter than the minimum length.');

  const versions = new Set<string>();
  for (const block of settings.blocks) {
    const name = `Block "${block.id}"`;
    if (!isWallTime(block.start) || !isWallTime(block.end)) problems.push(`${name}: the times must be written HH:MM.`);
    else if (minutesOf(block.end) <= minutesOf(block.start)) problems.push(`${name}: the end must be after the start.`);
    else if (minutesOf(block.end) - minutesOf(block.start) < settings.minimumMinutes) problems.push(`${name} is shorter than the minimum length.`);
    if (block.weekdays.some((day) => !wholeNumber(day, 1) || day > 7)) problems.push(`${name}: the days must be 1 (Monday) to 7 (Sunday).`);
    if (block.validFrom !== undefined && !isLocalDate(block.validFrom)) problems.push(`${name}: "valid from" must be a date written YYYY-MM-DD.`);
    const version = `${block.id}\n${block.validFrom ?? ''}`;
    if (versions.has(version)) problems.push(`${name} has two versions valid from the same day.`);
    versions.add(version);
  }
  return problems;
}

/**
 * The hours the price list sells recording by. The catalogue's `recording` entry (`../orders/catalogue.ts`) has
 * this shape; it is repeated here so that the booking does not depend on the orders.
 */
export interface RecordingHours {
  /** A fixed block is sold as this many hours. */
  block: { hours: number };
  /** The whole day is sold as this many hours. */
  day: { hours: number };
  /** A free window is priced as a multiple of this many minutes. */
  windowStepMinutes: number;
}

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * What is wrong between the hours the catalogue sells and the slots the booking offers, in plain sentences for
 * the admin; empty when they agree. The checkout prices a slot by its kind (a block at the block's price, the
 * whole day at the day's, a window by the hour), so a block of another length than the one sold would be charged
 * as if it were that length. Checked for every version of the blocks, on every day of the week:
 * - every online block lasts exactly the block's hours;
 * - where the whole day can be booked, the day's hours are those of its online blocks together (the breaks
 *   between them are not sold);
 * - a free window, which is always the minimum length, is a whole number of the catalogue's window steps.
 *
 * Assumes settings that pass `settingsProblems`.
 */
export function recordingProblems(settings: BookingSettings, sold: RecordingHours): string[] {
  const problems = new Set<string>();
  if (!wholeNumber(sold.windowStepMinutes, 1) || settings.minimumMinutes % sold.windowStepMinutes !== 0) {
    problems.add(`A free window lasts ${settings.minimumMinutes} minutes, which is not a multiple of the ${sold.windowStepMinutes} minutes the catalogue prices windows by.`);
  }
  // Each version takes over on its own date; a week from each of those dates sees every weekday of every version.
  const starts = new Set<LocalDate>(['2000-01-03']);
  for (const block of settings.blocks) if (block.validFrom !== undefined && isLocalDate(block.validFrom)) starts.add(block.validFrom);
  for (const start of starts) {
    for (let offset = 0; offset < 7; offset++) {
      const date = addDays(start, offset);
      const since = start === '2000-01-03' ? '' : ` from ${start}`;
      const online = blocksOn(date, settings).filter((block) => block.online);
      for (const block of online) {
        const minutes = block.endMinutes - block.startMinutes;
        if (minutes !== sold.block.hours * 60) problems.add(`Block "${block.id}"${since} lasts ${minutes / 60} h; the catalogue sells a block as ${sold.block.hours} h.`);
      }
      const together = online.reduce((sum, block) => sum + block.endMinutes - block.startMinutes, 0);
      if (settings.wholeDay && online.length > 1 && together !== sold.day.hours * 60) {
        problems.add(`The whole day on a ${WEEKDAY_NAMES[weekdayOf(date) - 1]}${since} is ${together / 60} h of blocks; the catalogue sells a day as ${sold.day.hours} h.`);
      }
    }
  }
  return [...problems];
}
