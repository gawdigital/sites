// Which recording sessions can be offered on a day. One room: every entry in the studio's calendar blocks it, and
// so does every confirmed or held session. Pure: the settings, the busy intervals and the technicians come in,
// the offered slots come out.
//
// The interpretations chosen where the specification leaves room:
//
// - A day is "broken by a rehearsal" when a calendar entry, with its buffer, takes at least one of the day's
//   online blocks. A rehearsal in the evening that leaves both blocks bookable does not break the day; one that
//   starts at 18:15 does (it needs the studio from 17:45), and so does one in the middle of the morning.
// - A day that is not broken offers its online blocks, each when it is free with the buffers, and the whole day
//   when all of them are. Recording sessions and holds never break a day: they only take the blocks they touch.
// - A broken day offers free windows instead: every start on the step, within the window hours, at which a
//   session of the minimum length fits with the buffers. Each such window is a slot of exactly the minimum
//   length; longer sessions on a broken day are not offered. `freeWindows` gives the stretches those slots cover.
// - The whole day is one session from the start of the first online block to the end of the last, the break
//   included: the studio and the technician are taken throughout. It needs at least two online blocks.
// - A day with no online block (by weekday, or by the switch) is closed: no free windows either.
// - Buffers are kept between a session and what surrounds it, not at the edges of the window hours, and an
//   interval that ends exactly where the buffer begins does not collide (intervals are half-open).
// - A technician's own busy time blocks that technician only, with `technicianBufferMinutes` around it (none by
//   default). Sessions need no technician bookkeeping here: with one room, two sessions never overlap.
// - Slots the studio is free for are listed even when no technician is: `technicians` is then empty and `anyone`
//   false, so a page can tell "taken" from "no technician". `isOffered` is the test for a customer's choice.
import type { TechnicianId, TechnicianRef } from '../shared/technician.ts';
import { blocksOn } from './settings.ts';
import type { BookingSettings } from './settings.ts';
import { addDays, datesBetween, instantOf, localDateOf, minutesOf, MINUTE } from './time.ts';
import type { LocalDate } from './time.ts';

/** A stretch of time between two instants (epoch milliseconds): the start included, the end not. */
export interface Interval {
  start: number;
  end: number;
}

/**
 * What keeps the studio busy:
 * - `calendar`: an entry in the shared calendar that is not a recording session (a rehearsal, anything else);
 * - `session`: a confirmed recording session;
 * - `hold`: a slot held while its customer pays, treated as a session.
 *
 * Confirmed sessions are written into the shared calendar too: when the calendar is read back, those entries must
 * come in as `session` (or be left out when the session is already listed), never as `calendar`, or they would
 * count as rehearsals.
 */
export type BusyKind = 'calendar' | 'session' | 'hold';

export interface Busy extends Interval {
  kind: BusyKind;
}

/**
 * A technician as the booking sees one: the shared id (the same id the catalogue's technician has, see
 * `../shared/technician.ts`) and the times taken.
 */
export interface Technician extends TechnicianRef {
  /** When the technician cannot work, whatever the reason. */
  busy: readonly Interval[];
}

export type SlotKind = 'block' | 'wholeDay' | 'window';

export interface Slot extends Interval {
  kind: SlotKind;
  date: LocalDate;
  /** The fixed blocks the slot is made of: one for a block, all of them for the whole day, none for a window. */
  blockIds: string[];
  /** The technicians free for the whole slot, in the order they were given. */
  technicians: TechnicianId[];
  /** Whether the slot can be booked with "anyone": at least one technician is free. */
  anyone: boolean;
}

/**
 * - `blocks`: the day is untouched by rehearsals, the fixed blocks apply;
 * - `windows`: a rehearsal breaks the day, free windows apply;
 * - `closed`: nothing can be booked online (no online block that day, a day in the past or beyond the horizon).
 */
export type DayMode = 'blocks' | 'windows' | 'closed';

export interface DayAvailability {
  date: LocalDate;
  mode: DayMode;
  /** The offered slots, by start and then by end. */
  slots: Slot[];
  /** On a broken day, the stretches the offered windows cover together; empty otherwise. */
  freeWindows: Interval[];
}

const collides = (a: Interval, b: Interval, bufferMinutes: number): boolean =>
  b.end > b.start && b.start < a.end + bufferMinutes * MINUTE && b.end > a.start - bufferMinutes * MINUTE;

/** Whether the studio is free for a session over `interval`, the buffers around everything else kept. */
export function isStudioFree(interval: Interval, studioBusy: readonly Busy[], settings: BookingSettings): boolean {
  return !studioBusy.some((busy) =>
    collides(interval, busy, busy.kind === 'calendar' ? settings.rehearsalBufferMinutes : settings.sessionBufferMinutes),
  );
}

/** The ids of the technicians free for the whole of `interval`, in the order given. */
export function freeTechnicians(interval: Interval, technicians: readonly Technician[], settings: BookingSettings): TechnicianId[] {
  return technicians
    .filter((technician) => !technician.busy.some((busy) => collides(interval, busy, settings.technicianBufferMinutes)))
    .map((technician) => technician.id);
}

/** Whether a slot can be booked with the customer's choice: a technician's id, or `null` for "anyone". */
export function isOffered(slot: Slot, technicianId: TechnicianId | null): boolean {
  return technicianId === null ? slot.anyone : slot.technicians.includes(technicianId);
}

/** The stretches a day's window slots cover together. */
function covered(slots: readonly Slot[]): Interval[] {
  const stretches: Interval[] = [];
  for (const slot of slots) {
    if (slot.kind !== 'window') continue;
    const last = stretches.at(-1);
    if (last && slot.start <= last.end) last.end = Math.max(last.end, slot.end);
    else stretches.push({ start: slot.start, end: slot.end });
  }
  return stretches;
}

const day = (date: LocalDate, mode: DayMode, slots: Slot[]): DayAvailability => ({ date, mode, slots, freeWindows: covered(slots) });

/**
 * What one day offers by the rules alone: no lead time, no horizon, no "now". `availability` adds those; the
 * hold logic uses this directly when it checks a slot again before confirming it.
 */
export function daySlots(
  date: LocalDate,
  settings: BookingSettings,
  studioBusy: readonly Busy[],
  technicians: readonly Technician[],
): DayAvailability {
  const at = (minutes: number): number => instantOf(date, minutes, settings.timeZone);
  const slot = (kind: SlotKind, start: number, end: number, blockIds: string[]): Slot => {
    const free = freeTechnicians({ start, end }, technicians, settings);
    return { kind, date, start, end, blockIds, technicians: free, anyone: free.length > 0 };
  };

  const blocks = blocksOn(date, settings)
    .filter((block) => block.online)
    .map((block) => ({ id: block.id, start: at(block.startMinutes), end: at(block.endMinutes) }));
  const first = blocks[0];
  const last = blocks.at(-1);
  if (!first || !last) return day(date, 'closed', []);

  const rehearsals = studioBusy.filter((busy) => busy.kind === 'calendar');
  const broken = blocks.some((block) => !isStudioFree(block, rehearsals, settings));

  const slots: Slot[] = [];
  if (!broken) {
    for (const block of blocks) {
      if (isStudioFree(block, studioBusy, settings)) slots.push(slot('block', block.start, block.end, [block.id]));
    }
    // The span is checked as well as the blocks: with buffers set to zero something could sit in a break.
    const span = { start: first.start, end: last.end };
    if (settings.wholeDay && blocks.length > 1 && slots.length === blocks.length && isStudioFree(span, studioBusy, settings)) {
      slots.push(slot('wholeDay', span.start, span.end, blocks.map((block) => block.id)));
    }
  } else {
    const { stepMinutes: step, minimumMinutes: minimum } = settings;
    if (!(step > 0)) throw new RangeError('The step must be positive.');
    const latest = minutesOf(settings.windowHours.end) - minimum;
    // Starts are counted on the wall clock, so "on the hour or half hour" holds on the days the clocks change too.
    for (let minutes = Math.ceil(minutesOf(settings.windowHours.start) / step) * step; minutes <= latest; minutes += step) {
      const window = { start: at(minutes), end: at(minutes + minimum) };
      if (isStudioFree(window, studioBusy, settings)) slots.push(slot('window', window.start, window.end, []));
    }
  }
  slots.sort((a, b) => a.start - b.start || a.end - b.end);
  return day(date, broken ? 'windows' : 'blocks', slots);
}

/**
 * The slots offered for a day, or for every day of a range (both ends included), as seen at `now`.
 *
 * `studioBusy` is everything that takes the room: the calendar's entries, the confirmed sessions and the holds
 * still running (see `busyOf` in `holds.ts`). On top of `daySlots`, a slot is offered only when it starts at
 * least the lead time after `now` and its day is within the horizon; days outside come back `closed`.
 */
export function availability(
  range: LocalDate | { from: LocalDate; to: LocalDate },
  settings: BookingSettings,
  studioBusy: readonly Busy[],
  technicians: readonly Technician[],
  now: number,
): DayAvailability[] {
  const { from, to } = typeof range === 'string' ? { from: range, to: range } : range;
  const today = localDateOf(now, settings.timeZone);
  const horizon = addDays(today, settings.horizonDays);
  const earliest = now + settings.leadTimeMinutes * MINUTE;
  return datesBetween(from, to).map((date) => {
    if (date < today || date > horizon) return day(date, 'closed', []);
    const { mode, slots } = daySlots(date, settings, studioBusy, technicians);
    return day(date, mode, slots.filter((slot) => slot.start >= earliest));
  });
}
