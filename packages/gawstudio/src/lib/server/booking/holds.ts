// Holding a slot while its customer pays, and confirming it: a pure state machine. A Durable Object will keep the
// state and call these one at a time, which is what makes one slot impossible to pay twice; nothing here stores,
// waits or generates anything. Every transition takes the state and the time, and returns the new state.
//
// The rules chosen where the specification leaves room:
//
// - A slot can be held when `availability` offers it at that moment: the request names its start and end, and
//   they must be exactly those of an offered slot (and the technician picked, or anyone, must be free for it).
// - A hold lives while `now < expiresAt`. Every transition first drops the holds that have run out.
// - Confirming checks the slot again against the calendar and the technicians as they are then, by the rules
//   alone: the lead time and the horizon are not asked twice, since a hold may outlive them by a few minutes.
// - A confirmation that fails for any reason frees the hold. Confirming after the time-out fails with `expired`,
//   even when the slot is still free: the caller refunds the payment, or holds the slot again and confirms that.
// - Confirming twice (a payment notification that is delivered again) returns the same session, changing nothing.
// - "Anyone" is settled on confirmation: of the technicians free for the slot, the one with the least confirmed
//   session time still ahead (sessions in the state that end after `now`), and among equals the one listed first.
import { daySlots, isOffered, availability } from './availability.ts';
import type { Busy, Interval, Slot, Technician } from './availability.ts';
import type { BookingSettings } from './settings.ts';
import { localDateOf, MINUTE } from './time.ts';

/** A slot held for a customer who is paying. `technicianId` is `null` for "anyone". */
export interface Hold extends Interval {
  id: string;
  technicianId: string | null;
  createdAt: number;
  /** The first instant at which the hold no longer counts. */
  expiresAt: number;
}

/** A confirmed recording session. It keeps the id of the hold it came from. */
export interface Session extends Interval {
  id: string;
  technicianId: string;
  confirmedAt: number;
}

/** Everything the serialised point remembers. Plain data: it can be stored as JSON. */
export interface BookingState {
  holds: readonly Hold[];
  sessions: readonly Session[];
}

export const EMPTY_STATE: BookingState = { holds: [], sessions: [] };

/**
 * What a transition is checked against, read fresh by the caller each time: the settings, the technicians, and
 * the shared calendar's entries without the sessions this state already holds (see `BusyKind`).
 */
export interface BookingContext {
  settings: BookingSettings;
  calendar: readonly Busy[];
  technicians: readonly Technician[];
}

/** The slot a customer chose. The caller supplies the id (a random one), so the transition stays pure. */
export interface HoldRequest extends Interval {
  id: string;
  /** The technician picked, or `null` for "anyone". */
  technicianId: string | null;
}

export type Refusal =
  /** The slot is not offered (any more): taken, held, blocked by the calendar, too soon, too far, or no slot at all. */
  | 'unavailable'
  /** The slot is free, the technician picked is not; with "anyone", no technician is. */
  | 'technician-unavailable'
  /** The technician picked does not exist. */
  | 'unknown-technician'
  /** Another hold or session already has the request's id. */
  | 'duplicate-id'
  /** No hold with that id: never made, released, or run out and cleared since. */
  | 'not-found'
  /** The hold ran out before it was confirmed. */
  | 'expired';

/** A transition's outcome. The state is the one to store in either case: a refusal may have cleared holds. */
export type Outcome<T> = ({ ok: true; state: BookingState } & T) | { ok: false; state: BookingState; reason: Refusal };

const sameSlot = (a: Interval, b: Interval): boolean => a.start === b.start && a.end === b.end;

/** The state without the holds that have run out; the same object when none has, so nothing needs storing. */
export function expire(state: BookingState, now: number): BookingState {
  const holds = state.holds.filter((hold) => hold.expiresAt > now);
  return holds.length === state.holds.length ? state : { ...state, holds };
}

/** When the next hold runs out: the time for the Durable Object's alarm. `undefined` with no holds. */
export function nextExpiry(state: BookingState): number | undefined {
  return state.holds.length ? Math.min(...state.holds.map((hold) => hold.expiresAt)) : undefined;
}

/** The state without a hold: the payment failed or was abandoned. Unknown ids change nothing. */
export function release(state: BookingState, holdId: string): BookingState {
  const holds = state.holds.filter((hold) => hold.id !== holdId);
  return holds.length === state.holds.length ? state : { ...state, holds };
}

/**
 * Everything that takes the studio at `now`: the calendar, the confirmed sessions and the running holds. This
 * is the `studioBusy` to give `availability` when a page lists the slots. `exceptHoldId` leaves one hold out.
 */
export function busyOf(state: BookingState, context: BookingContext, now: number, exceptHoldId?: string): Busy[] {
  return [
    ...context.calendar,
    ...state.sessions.map(({ start, end }): Busy => ({ start, end, kind: 'session' })),
    ...state.holds
      .filter((hold) => hold.expiresAt > now && hold.id !== exceptHoldId)
      .map(({ start, end }): Busy => ({ start, end, kind: 'hold' })),
  ];
}

/** Why a slot cannot go to the technician asked for, if it cannot. */
function technicianRefusal(slot: Slot, technicianId: string | null, context: BookingContext): Refusal | undefined {
  if (technicianId !== null && !context.technicians.some((technician) => technician.id === technicianId)) return 'unknown-technician';
  return isOffered(slot, technicianId) ? undefined : 'technician-unavailable';
}

/**
 * Hold a slot for a customer about to pay.
 *
 * Refused when the slot is not offered at `now`, with everything already confirmed or held counted in. Asking
 * again with the same id for the same slot returns the hold as it is (its time is not extended).
 */
export function hold(state: BookingState, request: HoldRequest, context: BookingContext, now: number): Outcome<{ hold: Hold }> {
  const current = expire(state, now);
  const refuse = (reason: Refusal): Outcome<{ hold: Hold }> => ({ ok: false, state: current, reason });

  const existing = current.holds.find((held) => held.id === request.id);
  if (existing) {
    const same = sameSlot(existing, request) && existing.technicianId === request.technicianId;
    return same ? { ok: true, state: current, hold: existing } : refuse('duplicate-id');
  }
  if (current.sessions.some((session) => session.id === request.id)) return refuse('duplicate-id');
  if (!Number.isFinite(request.start) || !Number.isFinite(request.end)) return refuse('unavailable');

  const { settings } = context;
  const date = localDateOf(request.start, settings.timeZone);
  const [offered] = availability(date, settings, busyOf(current, context, now), context.technicians, now);
  const slot = offered?.slots.find((candidate) => sameSlot(candidate, request));
  if (!slot) return refuse('unavailable');
  const refusal = technicianRefusal(slot, request.technicianId, context);
  if (refusal) return refuse(refusal);

  const held: Hold = {
    id: request.id,
    start: request.start,
    end: request.end,
    technicianId: request.technicianId,
    createdAt: now,
    expiresAt: now + settings.holdMinutes * MINUTE,
  };
  return { ok: true, state: { ...current, holds: [...current.holds, held] }, hold: held };
}

/** The technician "anyone" becomes: the least booked ahead of those free, then the first listed. */
export function assignTechnician(slot: Slot, state: BookingState, context: BookingContext, now: number): string | undefined {
  const ahead = (id: string): number =>
    state.sessions
      .filter((session) => session.technicianId === id && session.end > now)
      .reduce((total, session) => total + (session.end - session.start), 0);
  let chosen: string | undefined;
  let least = Infinity;
  // The context's order, not the slot's, decides between equals; a strict comparison keeps the first.
  for (const { id } of context.technicians) {
    if (!slot.technicians.includes(id)) continue;
    const load = ahead(id);
    if (load < least) [chosen, least] = [id, load];
  }
  return chosen;
}

/**
 * Turn a paid hold into a session.
 *
 * The slot is checked once more against the context as it is now (a rehearsal may have appeared in the calendar,
 * the technician may have become busy); when it no longer stands the hold is freed and the caller refunds.
 */
export function confirm(state: BookingState, holdId: string, context: BookingContext, now: number): Outcome<{ session: Session }> {
  const current = expire(state, now);
  const refuse = (reason: Refusal, next: BookingState = current): Outcome<{ session: Session }> => ({ ok: false, state: next, reason });

  const confirmed = current.sessions.find((session) => session.id === holdId);
  if (confirmed) return { ok: true, state: current, session: confirmed };
  const held = current.holds.find((candidate) => candidate.id === holdId);
  if (!held) return refuse(state.holds.some((candidate) => candidate.id === holdId) ? 'expired' : 'not-found');

  const freed = release(current, holdId);
  const { settings } = context;
  const date = localDateOf(held.start, settings.timeZone);
  const slot = daySlots(date, settings, busyOf(freed, context, now), context.technicians).slots.find((candidate) => sameSlot(candidate, held));
  if (!slot) return refuse('unavailable', freed);
  const refusal = technicianRefusal(slot, held.technicianId, context);
  const technicianId = held.technicianId ?? assignTechnician(slot, freed, context, now);
  if (refusal || technicianId === undefined) return refuse(refusal ?? 'technician-unavailable', freed);

  const session: Session = { id: held.id, start: held.start, end: held.end, technicianId, confirmedAt: now };
  return { ok: true, state: { ...freed, sessions: [...freed.sessions, session] }, session };
}
