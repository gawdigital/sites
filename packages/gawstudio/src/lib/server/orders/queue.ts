// The technicians' queue: when would a new order be delivered? Pure: capacities, the existing queue and the
// working week in, Prague calendar dates out.
//
// The scheduling model:
// - Load is in the catalogue's load units, so mixes, masters and their AI-assisted kinds add up in one queue.
// - A technician works the queue strictly in the order given (first in, first out), one order after another.
// - The weekly capacity is spread evenly over the week's working days: with 6000 a week and five working days,
//   each working day gets through 1200. A week is Monday to Sunday in Prague; `capacityByWeek` replaces the
//   capacity of single weeks (holidays, a busy stretch).
// - Work on anything in the queue continues on the first working day after today: today's remaining hours are
//   not counted, so an estimate does not depend on the time of day and is never too early.
// - An order is delivered on the working day on which the capacity accumulated since then covers the load of
//   everything before it plus its own. The sums are kept in integers (load × working days a week).
// - An order's load is the quote's, unless the technician adjusted it (`adjustedLoad`), which then counts instead.
// There is no fixed turnaround: an empty queue means the first working day that fits the order.
import type { QueueKind } from './catalogue.ts';
import { addDays, isoWeekday, pragueDate, weekStart } from './dates.ts';
import type { CalendarDate } from './dates.ts';

/** A technician as the queue sees them; a catalogue `Technician` fits. */
export interface QueueTechnician {
  id: string;
  /** Load units a week. */
  weeklyCapacity: number;
  /** Capacity of single weeks, by the week's Monday (`YYYY-MM-DD`); 0 for a week off. */
  capacityByWeek?: Record<CalendarDate, number>;
}

/** An order waiting or being worked on. The queue is an array of these, in working order. */
export interface QueueEntry {
  orderId: string;
  technician: string;
  kind: QueueKind;
  /** The load from the quote, in load units. */
  load: number;
  /** The technician's own figure for this order, replacing `load`. */
  adjustedLoad?: number;
}

export interface WorkWeek {
  /** ISO weekdays worked: 1 is Monday, 7 is Sunday. */
  workingDays: readonly number[];
}

/** Monday to Friday: an example for the settings. Public holidays are not known here; use `capacityByWeek`. */
export const EXAMPLE_WORK_WEEK: WorkWeek = { workingDays: [1, 2, 3, 4, 5] };

export interface ScheduledEntry {
  entry: QueueEntry;
  /** The expected delivery date; `undefined` when the technician's capacity never covers it. */
  date: CalendarDate | undefined;
}

export interface Estimate {
  technician: string;
  /** The expected delivery date, a Prague calendar date. */
  date: CalendarDate;
  /** The load queued before the new order, in load units. */
  loadAhead: number;
  /** The new order's load. */
  load: number;
}

/** How far ahead the queue is looked through before a load counts as never done: ten years. */
const HORIZON_DAYS = 3660;

/** The load an entry counts for: the technician's adjustment when there is one. Never negative. */
export function effectiveLoad(entry: Pick<QueueEntry, 'load' | 'adjustedLoad'>): number {
  return Math.max(0, entry.adjustedLoad ?? entry.load);
}

/** A technician's entries, in queue order. */
export function queueOf(queue: readonly QueueEntry[], technician: string): QueueEntry[] {
  return queue.filter((entry) => entry.technician === technician);
}

function capacityIn(technician: QueueTechnician, week: CalendarDate): number {
  const own = technician.capacityByWeek;
  return Math.max(0, own && Object.hasOwn(own, week) ? own[week]! : technician.weeklyCapacity);
}

/**
 * The dates on which running totals of load (ascending) are reached, walking the working days after `today`.
 * Each working day adds `capacity / days a week`; both sides are multiplied by the days a week to stay integer.
 */
function datesReached(technician: QueueTechnician, totals: readonly number[], week: WorkWeek, today: CalendarDate): (CalendarDate | undefined)[] {
  const days = new Set(week.workingDays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7));
  const dates: (CalendarDate | undefined)[] = totals.map(() => undefined);
  if (!days.size) return dates;
  let done = 0;
  let next = 0;
  let date = today;
  for (let i = 0; i < HORIZON_DAYS && next < totals.length; i++) {
    date = addDays(date, 1);
    if (!days.has(isoWeekday(date))) continue;
    const capacity = capacityIn(technician, weekStart(date));
    if (capacity === 0) continue;
    done += capacity;
    while (next < totals.length && totals[next]! * days.size <= done) dates[next++] = date;
  }
  return dates;
}

/** The expected delivery date of every order in a technician's queue, in queue order: the admin's view. */
export function schedule(technician: QueueTechnician, queue: readonly QueueEntry[], week: WorkWeek, now: Date): ScheduledEntry[] {
  const entries = queueOf(queue, technician.id);
  let total = 0;
  const totals = entries.map((entry) => (total += effectiveLoad(entry)));
  const dates = datesReached(technician, totals, week, pragueDate(now));
  return entries.map((entry, i) => ({ entry, date: dates[i] }));
}

export interface EstimateInput {
  /** The whole queue; other technicians' entries are ignored. */
  queue: readonly QueueEntry[];
  /** The new order's load for this technician, in load units (a quote's `work[].load`). */
  load: number;
  week: WorkWeek;
  now: Date;
}

/** When a new order, added at the end of the technician's queue, would be delivered; `undefined` if never. */
export function estimateDelivery(technician: QueueTechnician, input: EstimateInput): Estimate | undefined {
  const load = Math.max(0, input.load);
  const loadAhead = queueOf(input.queue, technician.id).reduce((sum, entry) => sum + effectiveLoad(entry), 0);
  const [date] = datesReached(technician, [loadAhead + load], input.week, pragueDate(input.now));
  return date === undefined ? undefined : { technician: technician.id, date, loadAhead, load };
}

/**
 * "Anyone": the technician who would deliver first, and when. `technicians` are the candidates who offer the
 * service (`techniciansFor`); on the same date the one with less queued wins, then the earlier in the list.
 */
export function estimateForAnyone(technicians: readonly QueueTechnician[], input: EstimateInput): Estimate | undefined {
  let best: Estimate | undefined;
  for (const technician of technicians) {
    const estimate = estimateDelivery(technician, input);
    if (!estimate) continue;
    if (!best || estimate.date < best.date || (estimate.date === best.date && estimate.loadAhead < best.loadAhead)) best = estimate;
  }
  return best;
}
