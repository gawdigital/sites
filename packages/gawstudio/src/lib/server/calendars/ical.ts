// A minimal iCalendar (RFC 5545) reader and writer: just enough to learn when a calendar is busy and to write
// our own sessions into it. No dependency, only Intl.
//
// Read: VEVENT with DTSTART and DTEND or DURATION, in each date form: UTC (`…Z`), floating (read in the studio's
// zone), `TZID=` (an IANA id, resolved by Intl; the VTIMEZONE definitions are ignored) and all-day `VALUE=DATE`
// (studio midnight to midnight). Folded lines, quoted parameters, escaped text. `STATUS:CANCELLED` and
// `TRANSP:TRANSPARENT` events are not busy.
//
// Recurrence, expanded within the queried window:
//   SUPPORTED    FREQ=DAILY and FREQ=WEEKLY with INTERVAL, BYDAY (plain weekdays), WKST, COUNT and UNTIL;
//                FREQ=MONTHLY and FREQ=YEARLY in their plain form only (the same day of the month, or the same
//                date, as DTSTART; INTERVAL, COUNT, UNTIL; a BYMONTHDAY/BYMONTH that merely repeats DTSTART);
//                EXDATE (date-time or date); RECURRENCE-ID overrides of single occurrences (moved, changed or
//                cancelled), and the already-expanded instances a server returns for `<expand>`.
//   UNSUPPORTED  FREQ=SECONDLY/MINUTELY/HOURLY; BYDAY with an ordinal (`1MO`, `-1FR`) or under MONTHLY/YEARLY;
//                BYMONTHDAY/BYMONTH that differ from DTSTART or stand under DAILY/WEEKLY; BYSETPOS, BYYEARDAY,
//                BYWEEKNO, BYHOUR, BYMINUTE, BYSECOND; more than one RRULE; RDATE; EXRULE;
//                RECURRENCE-ID with RANGE=THISANDFUTURE.
// An unsupported form is never dropped silently: the event's first occurrence is still counted and an
// `unsupported-recurrence` problem names the event and the rule, for the caller to report.
//
// A recurrence runs in the wall clock of its DTSTART (RFC 5545 §3.3.10), so a weekly rehearsal at 18:00 Prague
// time stays at 18:00 across both DST changes. A DTSTART that does not itself match the rule's BYDAY is not
// counted as an extra occurrence (RFC 5545 leaves that case undefined).

import { type BusyInterval, type BusyProblem, type BusyReading, byStart, STUDIO_ZONE } from './types.ts';
import { DAY, HOUR, instantToWall, MINUTE, resolveZone, SECOND, wallToInstant } from './zone.ts';

/** One unfolded content line: `NAME;PARAM=value:value`. Names are upper-cased, values left as written. */
export interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** A date or date-time as written: a calendar date, an instant, or a wall-clock reading in a zone. */
export type When = { form: 'date'; wall: number } | { form: 'utc'; instant: number } | { form: 'local'; wall: number; zone: string };

/** A VEVENT, with its times as wall values in `zone` (see `zone.ts`). */
export interface VEvent {
  uid: string;
  summary?: string;
  allDay: boolean;
  /** The zone the event's wall clock runs in: its TZID, `UTC`, or the studio's for floating and all-day ones. */
  zone: string;
  startWall: number;
  endWall: number;
  cancelled: boolean;
  transparent: boolean;
  rrules: string[];
  exdates: When[];
  hasRdate: boolean;
  hasExrule: boolean;
  recurrenceId?: When;
  thisAndFuture: boolean;
}

export interface ParsedCalendar {
  events: VEvent[];
  problems: BusyProblem[];
}

/** The longest series a rule may run through before the reader gives up (and says so). */
const MAX_STEPS = 200_000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// Lines

/** The content lines of a text, with folded lines (a line break followed by a space or a tab) joined again. */
export function unfold(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

/** Reads one content line; `undefined` when it has no `:` to separate the value. */
export function parseLine(line: string): ContentLine | undefined {
  let i = 0;
  while (i < line.length && line[i] !== ';' && line[i] !== ':') i++;
  const name = line.slice(0, i).trim().toUpperCase();
  const params: Record<string, string> = {};
  while (line[i] === ';') {
    const eq = line.indexOf('=', i);
    if (eq < 0) return undefined;
    const key = line.slice(i + 1, eq).trim().toUpperCase();
    i = eq + 1;
    let value = '';
    // A value is a comma-separated list of plain and quoted parts; a quoted part may hold `:`, `;` and `,`.
    while (i < line.length && line[i] !== ';' && line[i] !== ':') {
      if (line[i] === '"') {
        const close = line.indexOf('"', i + 1);
        if (close < 0) return undefined;
        value += line.slice(i + 1, close);
        i = close + 1;
      } else {
        value += line[i];
        i++;
      }
    }
    params[key] = value;
  }
  if (line[i] !== ':' || name === '') return undefined;
  return { name, params, value: line.slice(i + 1) };
}

/** A TEXT value as written into a calendar: backslash, semicolon, comma and line breaks escaped. */
export function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n?|\n/g, '\\n');
}

/** A TEXT value as it was meant. */
export function unescapeText(s: string): string {
  return s.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** One content line folded to at most 75 octets a line (RFC 5545 §3.1), never inside a character. */
export function fold(line: string): string {
  const encoder = new TextEncoder();
  let out = '';
  let width = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (width + size > 75) {
      out += '\r\n ';
      width = 1;
    }
    out += ch;
    width += size;
  }
  return out;
}

// Values

/** A DATE or DATE-TIME value; a string says why it could not be read. */
export function parseWhen(value: string, params: Record<string, string>, studioZone: string = STUDIO_ZONE): When | string {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/i.exec(value.trim());
  if (!m) return `unreadable date "${value}"`;
  const date = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (m[4] === undefined) return { form: 'date', wall: date };
  const at = date + Number(m[4]) * HOUR + Number(m[5]) * MINUTE + Number(m[6]) * SECOND;
  if (m[7] !== undefined) return { form: 'utc', instant: at };
  const tzid = params.TZID;
  if (tzid === undefined) return { form: 'local', wall: at, zone: studioZone };
  const zone = resolveZone(tzid);
  return zone === undefined ? `unknown time zone "${tzid}"` : { form: 'local', wall: at, zone };
}

/** A DURATION value in milliseconds (a day counts 24 hours, a week 7 days), or `undefined`. */
export function parseDuration(value: string): number | undefined {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
  if (!m || value.trim().length < 3) return undefined;
  const n = (s: string | undefined): number => (s === undefined ? 0 : Number(s));
  const ms = n(m[2]) * 7 * DAY + n(m[3]) * DAY + n(m[4]) * HOUR + n(m[5]) * MINUTE + n(m[6]) * SECOND;
  return m[1] === '-' ? -ms : ms;
}

function wallIn(when: When, zone: string): number {
  if (when.form === 'date') return when.wall;
  if (when.form === 'utc') return instantToWall(when.instant, zone);
  return when.zone === zone ? when.wall : instantToWall(wallToInstant(when.wall, when.zone), zone);
}

// Events

function readEvent(lines: ContentLine[], studioZone: string): VEvent | BusyProblem {
  const first = (name: string): ContentLine | undefined => lines.find((l) => l.name === name);
  const uid = first('UID')?.value.trim() ?? '';
  const eventId = uid === '' ? undefined : uid;
  const unreadable = (reason: string): BusyProblem => ({ kind: 'unreadable-event', eventId, reason });

  const dtstart = first('DTSTART');
  if (!dtstart) return unreadable('no DTSTART');
  const start = parseWhen(dtstart.value, dtstart.params, studioZone);
  if (typeof start === 'string') return unreadable(`DTSTART: ${start}`);

  const allDay = start.form === 'date';
  const zone = start.form === 'local' ? start.zone : start.form === 'utc' ? 'UTC' : studioZone;
  const startWall = start.form === 'utc' ? start.instant : start.wall;

  let endWall = allDay ? startWall + DAY : startWall;
  const dtend = first('DTEND');
  const duration = first('DURATION');
  if (dtend) {
    const end = parseWhen(dtend.value, dtend.params, studioZone);
    if (typeof end === 'string') return unreadable(`DTEND: ${end}`);
    endWall = wallIn(end, zone);
  } else if (duration) {
    const ms = parseDuration(duration.value);
    if (ms === undefined) return unreadable(`DURATION: unreadable duration "${duration.value}"`);
    endWall = startWall + ms;
  }
  // Some writers end a one-day event on the day it starts; it still takes that day.
  if (allDay && endWall <= startWall) endWall = startWall + DAY;

  const exdates: When[] = [];
  for (const line of lines.filter((l) => l.name === 'EXDATE')) {
    for (const value of line.value.split(',')) {
      const when = parseWhen(value, line.params, studioZone);
      if (typeof when === 'string') return unreadable(`EXDATE: ${when}`);
      exdates.push(when);
    }
  }

  let recurrenceId: When | undefined;
  const rid = first('RECURRENCE-ID');
  if (rid) {
    const when = parseWhen(rid.value, rid.params, studioZone);
    if (typeof when === 'string') return unreadable(`RECURRENCE-ID: ${when}`);
    recurrenceId = when;
  }

  const summary = first('SUMMARY');
  return {
    uid,
    summary: summary ? unescapeText(summary.value) : undefined,
    allDay,
    zone,
    startWall,
    endWall,
    cancelled: first('STATUS')?.value.trim().toUpperCase() === 'CANCELLED',
    transparent: first('TRANSP')?.value.trim().toUpperCase() === 'TRANSPARENT',
    rrules: lines.filter((l) => l.name === 'RRULE').map((l) => l.value.trim()),
    exdates,
    hasRdate: lines.some((l) => l.name === 'RDATE'),
    hasExrule: lines.some((l) => l.name === 'EXRULE'),
    recurrenceId,
    thisAndFuture: rid?.params.RANGE?.toUpperCase() === 'THISANDFUTURE',
  };
}

/** Every VEVENT of a calendar text (alarms and time zone definitions inside are skipped). */
export function parseCalendar(text: string, studioZone: string = STUDIO_ZONE): ParsedCalendar {
  const events: VEvent[] = [];
  const problems: BusyProblem[] = [];
  const open: string[] = [];
  let current: ContentLine[] | undefined;
  for (const raw of unfold(text)) {
    const line = parseLine(raw);
    if (!line) continue;
    if (line.name === 'BEGIN') {
      const component = line.value.trim().toUpperCase();
      if (component === 'VEVENT' && current === undefined) current = [];
      open.push(component);
    } else if (line.name === 'END') {
      const component = line.value.trim().toUpperCase();
      if (component === 'VEVENT' && current !== undefined && open.filter((c) => c === 'VEVENT').length === 1) {
        const event = readEvent(current, studioZone);
        if ('kind' in event) problems.push(event);
        else events.push(event);
        current = undefined;
      }
      const at = open.lastIndexOf(component);
      if (at >= 0) open.length = at;
    } else if (current !== undefined && open[open.length - 1] === 'VEVENT') {
      current.push(line);
    }
  }
  return { events, problems };
}

// Recurrence

type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

interface Rule {
  freq: Frequency;
  interval: number;
  count?: number;
  /** The last wall reading (in the event's zone) an occurrence may start at. */
  untilWall?: number;
  /** Weekdays, 0 = Sunday. */
  byDay?: number[];
  weekStart: number;
}

const dayOf = (wallValue: number): number => Math.floor(wallValue / DAY);
const weekdayOf = (day: number): number => (((day + 4) % 7) + 7) % 7;

/** An RRULE as this reader expands it; a string names what it does not support. */
function parseRule(text: string, event: VEvent, studioZone: string): Rule | string {
  const parts = new Map<string, string>();
  for (const part of text.split(';')) {
    if (part.trim() === '') continue;
    const eq = part.indexOf('=');
    if (eq < 0) return `unreadable part "${part}"`;
    parts.set(part.slice(0, eq).trim().toUpperCase(), part.slice(eq + 1).trim().toUpperCase());
  }
  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return `FREQ=${freq ?? ''} is not supported`;
  const rule: Rule = { freq, interval: 1, weekStart: 1 };
  const start = new Date(event.startWall);
  const coarse = freq === 'MONTHLY' || freq === 'YEARLY';

  for (const [key, value] of parts) {
    if (key === 'FREQ') continue;
    if (key === 'INTERVAL' || key === 'COUNT') {
      if (!/^\d+$/.test(value) || Number(value) < 1) return `${key}=${value} is not a positive number`;
      if (key === 'INTERVAL') rule.interval = Number(value);
      else rule.count = Number(value);
    } else if (key === 'UNTIL') {
      const until = parseWhen(value, {}, studioZone);
      if (typeof until === 'string') return `UNTIL: ${until}`;
      // UNTIL is inclusive; a date allows the whole of that day. A floating one is in the event's own zone.
      if (until.form === 'date') rule.untilWall = until.wall + DAY - 1;
      else rule.untilWall = until.form === 'utc' ? instantToWall(until.instant, event.zone) : until.wall;
    } else if (key === 'WKST') {
      const day = WEEKDAYS.indexOf(value);
      if (day < 0) return `WKST=${value} is not a weekday`;
      rule.weekStart = day;
    } else if (key === 'BYDAY') {
      if (coarse) return `BYDAY with FREQ=${freq} is not supported`;
      const days = value.split(',').map((d) => WEEKDAYS.indexOf(d.trim()));
      if (days.some((d) => d < 0)) return `BYDAY=${value} (an ordinal or an unknown weekday) is not supported`;
      rule.byDay = [...new Set(days)];
    } else if (key === 'BYMONTHDAY') {
      if (!coarse || value !== String(start.getUTCDate())) return `BYMONTHDAY=${value} is not supported`;
    } else if (key === 'BYMONTH') {
      if (freq !== 'YEARLY' || value !== String(start.getUTCMonth() + 1)) return `BYMONTH=${value} is not supported`;
    } else {
      return `${key} is not supported`;
    }
  }
  return rule;
}

/**
 * The days (as day numbers of the wall clock) the rule falls on, from `step` periods after the start onwards,
 * without end: the caller stops at COUNT, UNTIL or the window. A period that yields no day gives `NaN`, so that
 * the caller can count the steps of a series that never produces anything.
 */
function* ruleDays(rule: Rule, startWall: number, step: number): Generator<number> {
  const startDay = dayOf(startWall);
  if (rule.freq === 'DAILY') {
    for (let n = step; ; n++) {
      const day = startDay + n * rule.interval;
      if (!rule.byDay || rule.byDay.includes(weekdayOf(day))) yield day;
      else yield Number.NaN;
    }
  } else if (rule.freq === 'WEEKLY') {
    const fromWeekStart = (d: number): number => (d - rule.weekStart + 7) % 7;
    const weekStart = startDay - fromWeekStart(weekdayOf(startDay));
    const offsets = (rule.byDay ?? [weekdayOf(startDay)]).map(fromWeekStart).sort((a, b) => a - b);
    for (let n = step; ; n++) {
      for (const offset of offsets) {
        const day = weekStart + n * rule.interval * 7 + offset;
        yield day < startDay ? Number.NaN : day;
      }
    }
  } else {
    // Monthly and yearly: the same day of the month; a month without it (the 31st, 29 February) is skipped.
    const start = new Date(startWall);
    const months = rule.freq === 'YEARLY' ? 12 * rule.interval : rule.interval;
    for (let n = step; ; n++) {
      const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + n * months, start.getUTCDate()));
      yield date.getUTCDate() === start.getUTCDate() ? dayOf(date.getTime()) : Number.NaN;
    }
  }
}

interface Excluded {
  walls: Set<number>;
  days: Set<number>;
}

function exclude(excluded: Excluded, when: When, zone: string): void {
  if (when.form === 'date') excluded.days.add(dayOf(when.wall));
  else excluded.walls.add(wallIn(when, zone));
}

/** The wall starts of a recurring event's occurrences that may touch `[from, to)`; a string when it gives up. */
function occurrences(event: VEvent, rule: Rule, excluded: Excluded, from: number, to: number): number[] | string {
  const span = event.endWall - event.startWall;
  const timeOfDay = event.startWall - dayOf(event.startWall) * DAY;
  // The window in the event's wall clock, a day wider on each side: the exact check is made on instants later.
  const fromWall = instantToWall(from, event.zone) - DAY;
  const toWall = instantToWall(to, event.zone) + DAY;

  // Without COUNT nothing depends on the occurrences before the window: jump to just before it.
  let step = 0;
  if (rule.count === undefined && (rule.freq === 'DAILY' || rule.freq === 'WEEKLY')) {
    const period = rule.interval * (rule.freq === 'WEEKLY' ? 7 : 1) * DAY;
    step = Math.max(0, Math.floor((fromWall - span - event.startWall) / period) - 1);
  }

  const starts: number[] = [];
  let counted = 0;
  let steps = 0;
  for (const day of ruleDays(rule, event.startWall, step)) {
    if (++steps > MAX_STEPS) return `the series is longer than ${MAX_STEPS} steps`;
    if (Number.isNaN(day)) continue;
    const start = day * DAY + timeOfDay;
    if (rule.count !== undefined && counted >= rule.count) break;
    if (rule.untilWall !== undefined && start > rule.untilWall) break;
    if (start >= toWall) break;
    // COUNT counts the excluded occurrences too: EXDATE removes them from a set that is already complete.
    counted++;
    if (start + span <= fromWall) continue;
    if (excluded.walls.has(start) || excluded.days.has(day)) continue;
    starts.push(start);
  }
  return starts;
}

// Busy time

/**
 * The busy time within `[from, to)` that one or more calendar texts hold (a CalDAV REPORT returns one text per
 * event). Events of the same UID are read together, so an override replaces its occurrence of the series
 * wherever the two were written.
 */
export function busyFromICalendar(sources: string | readonly string[], from: number, to: number, studioZone: string = STUDIO_ZONE): BusyReading {
  const intervals: BusyInterval[] = [];
  const problems: BusyProblem[] = [];
  const events: VEvent[] = [];
  for (const text of typeof sources === 'string' ? [sources] : sources) {
    const parsed = parseCalendar(text, studioZone);
    events.push(...parsed.events);
    problems.push(...parsed.problems);
  }

  const overrides = new Map<string, VEvent[]>();
  for (const event of events) {
    if (event.recurrenceId && event.uid !== '') overrides.set(event.uid, [...(overrides.get(event.uid) ?? []), event]);
  }

  const emit = (event: VEvent, startWall: number): void => {
    const start = wallToInstant(startWall, event.zone);
    const end = wallToInstant(startWall + (event.endWall - event.startWall), event.zone);
    if (end > start && start < to && end > from) {
      intervals.push({ start, end, allDay: event.allDay, ...(event.uid === '' ? {} : { eventId: event.uid }) });
    }
  };

  for (const event of events) {
    // What is not busy needs no expanding, and its recurrence, supported or not, is nobody's problem.
    if (event.cancelled || event.transparent) continue;
    const eventId = event.uid === '' ? undefined : event.uid;
    const unsupported = (rule: string, reason: string): void => {
      problems.push({ kind: 'unsupported-recurrence', eventId, rule, reason });
    };

    if (event.recurrenceId) {
      if (event.thisAndFuture) {
        unsupported('RECURRENCE-ID;RANGE=THISANDFUTURE', 'only this occurrence was changed; the following ones were read from the series as it was');
      }
      emit(event, event.startWall);
      continue;
    }

    if (event.hasRdate) unsupported('RDATE', 'RDATE is not supported; its extra occurrences were not counted');
    if (event.rrules.length === 0) {
      emit(event, event.startWall);
      continue;
    }
    if (event.hasExrule) unsupported('EXRULE', 'EXRULE is not supported; the occurrences it excludes were counted');

    const text = event.rrules.join(' + ');
    const rule = event.rrules.length > 1 ? 'more than one RRULE is not supported' : parseRule(event.rrules[0] ?? '', event, studioZone);
    if (typeof rule === 'string') {
      unsupported(text, `${rule}; only the first occurrence was counted`);
      emit(event, event.startWall);
      continue;
    }

    const excluded: Excluded = { walls: new Set(), days: new Set() };
    for (const exdate of event.exdates) exclude(excluded, exdate, event.zone);
    for (const override of overrides.get(event.uid) ?? []) {
      if (override.recurrenceId) exclude(excluded, override.recurrenceId, event.zone);
    }

    const starts = occurrences(event, rule, excluded, from, to);
    if (typeof starts === 'string') {
      unsupported(text, `${starts}; only the first occurrence was counted`);
      emit(event, event.startWall);
      continue;
    }
    for (const start of starts) emit(event, start);
  }

  return { intervals: intervals.sort(byStart), problems };
}

// Writing

export interface CalendarEventText {
  uid: string;
  start: number;
  end: number;
  summary: string;
  description?: string;
  location?: string;
  /** When this text was produced (DTSTAMP, LAST-MODIFIED). */
  stamp: number;
}

/** An instant in the UTC form: `20261124T170000Z`. */
export function formatUtc(instant: number): string {
  return new Date(instant).toISOString().replace(/[-:]|\.\d{3}/g, '');
}

/** A calendar text holding one opaque, confirmed event in UTC: what we PUT into the studio's calendar. */
export function writeCalendar(event: CalendarEventText): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//G.A.W.Studio//Booking//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${escapeText(event.uid)}`,
    `DTSTAMP:${formatUtc(event.stamp)}`,
    `LAST-MODIFIED:${formatUtc(event.stamp)}`,
    `DTSTART:${formatUtc(event.start)}`,
    `DTEND:${formatUtc(event.end)}`,
    `SUMMARY:${escapeText(event.summary)}`,
    ...(event.description ? [`DESCRIPTION:${escapeText(event.description)}`] : []),
    ...(event.location ? [`LOCATION:${escapeText(event.location)}`] : []),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
