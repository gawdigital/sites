// The "rehearsal written over a paid session" case. Everything in the studio's shared calendar blocks the
// studio, and anybody with access can write into it, also over a session a customer has paid for. The system
// never moves such an entry: it notices it on the next poll and reports it, for people to sort out.

import { type BusyInterval, overlaps } from './types.ts';
import { isOurUid } from './uid.ts';

/** A confirmed recording session of ours. */
export interface Session {
  bookingId: string;
  start: number;
  end: number;
}

export interface Conflict {
  session: Session;
  /** The foreign entries that overlap the session, by start. */
  foreign: BusyInterval[];
}

/**
 * The sessions that a foreign entry of the studio's calendar overlaps. Our own events (recognised by their UID,
 * whichever booking they belong to) are left out; an entry without an id cannot be ours and counts as foreign.
 * Entries that merely touch a session's start or end do not overlap it. Pure: the caller decides whom to tell.
 */
export function detectConflicts(
  sessions: readonly Session[],
  busy: readonly BusyInterval[],
  isOurs: (eventId: string | undefined) => boolean = isOurUid,
): Conflict[] {
  const foreign = busy.filter((interval) => !isOurs(interval.eventId)).sort((a, b) => a.start - b.start || a.end - b.end);
  const conflicts: Conflict[] = [];
  for (const session of sessions) {
    const over = foreign.filter((interval) => overlaps(session.start, session.end, interval.start, interval.end));
    if (over.length > 0) conflicts.push({ session, foreign: over });
  }
  return conflicts;
}
