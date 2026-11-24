// The booking state on D1: the holds and sessions of `BookingState` (`../booking/holds.ts`) as rows, and the one
// thing the pure state machine asks of its keeper: that its transitions happen one at a time.
//
// `holds.ts` expects a single serialised point (it names a Durable Object). Here that point is a counter,
// `booking_revision`: `load` reads it with the state, and `save` writes the difference between the state loaded
// and the state a transition returned in one batch whose every statement applies only while the counter is what
// `load` saw, the last one moving it on. A batch is one transaction, so of two requests that loaded the same
// state exactly one stores its result; the other gets `false`, loads again and runs its transition again on what
// is there now. That is the whole protocol:
//
//   for (;;) {
//     const loaded = await bookings.load(now);
//     const outcome = hold(loaded.state, request, context, now);
//     if (await bookings.save(loaded, outcome.state)) return outcome;
//   }
import type { BookingState, Hold, Session } from '../booking/holds.ts';
import { changesOf, rowsOf } from './d1.ts';
import type { D1Like, D1StatementLike } from './d1.ts';

/** A state as `load` read it, with the revision `save` must find unchanged. */
export interface LoadedBooking {
  state: BookingState;
  revision: number;
}

interface HoldRow {
  id: string;
  start_at: number;
  end_at: number;
  technician_id: string | null;
  created_at: number;
  expires_at: number;
}

interface SessionRow {
  id: string;
  start_at: number;
  end_at: number;
  technician_id: string;
  confirmed_at: number;
}

const hold = (row: HoldRow): Hold => ({
  id: row.id,
  start: row.start_at,
  end: row.end_at,
  technicianId: row.technician_id,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
});

const session = (row: SessionRow): Session => ({
  id: row.id,
  start: row.start_at,
  end: row.end_at,
  technicianId: row.technician_id,
  confirmedAt: row.confirmed_at,
});

/** Applies only while the booking state is at the revision (`?1`) the caller loaded. */
const UNCHANGED = '(SELECT revision FROM booking_revision WHERE id = 1) = ?1';

const sameHold = (a: Hold, b: Hold): boolean =>
  a.id === b.id && a.start === b.start && a.end === b.end && a.technicianId === b.technicianId && a.createdAt === b.createdAt && a.expiresAt === b.expiresAt;

const sameSession = (a: Session, b: Session): boolean =>
  a.id === b.id && a.start === b.start && a.end === b.end && a.technicianId === b.technicianId && a.confirmedAt === b.confirmedAt;

/** What to delete and what to insert to get from one list to another; a changed item is both. */
function difference<T extends { id: string }>(before: readonly T[], after: readonly T[], same: (a: T, b: T) => boolean) {
  const kept = (list: readonly T[], item: T): boolean => list.some((other) => same(other, item));
  return { removed: before.filter((item) => !kept(after, item)), added: after.filter((item) => !kept(before, item)) };
}

export class BookingRepository {
  readonly #db: D1Like;

  constructor(db: D1Like) {
    this.#db = db;
  }

  /**
   * The state and its revision, read in one batch. `sessionsEndingAfter` leaves out the sessions that ended at
   * or before that time: pass the current time (or a little earlier), since no transition looks at a finished
   * session for the slots; leave it out to read everything. `ids` are the hold and session ids the transition
   * looks up: their sessions are read however long ago they ended, so that an id stays unique (`duplicate-id`)
   * and confirming twice still finds the session it gave.
   */
  async load(sessionsEndingAfter = Number.MIN_SAFE_INTEGER, ids: readonly string[] = []): Promise<LoadedBooking> {
    const named = ids.length ? ` OR id IN (${ids.map((_, i) => `?${i + 2}`).join(', ')})` : '';
    const [revision, holds, sessions] = await this.#db.batch([
      this.#db.prepare('SELECT revision FROM booking_revision WHERE id = 1'),
      this.#db.prepare('SELECT * FROM booking_holds ORDER BY created_at, id'),
      this.#db.prepare(`SELECT * FROM booking_sessions WHERE end_at > ?1${named} ORDER BY confirmed_at, id`).bind(sessionsEndingAfter, ...ids),
    ]);
    const [counter] = rowsOf<{ revision: number }>(revision);
    if (!counter) throw new Error('db: booking_revision has no row; the migrations have not been applied');
    return { state: { holds: rowsOf<HoldRow>(holds).map(hold), sessions: rowsOf<SessionRow>(sessions).map(session) }, revision: counter.revision };
  }

  /**
   * Stores the state a transition returned for `loaded`. `true` when it is stored, or when there was nothing to
   * store (the transitions return the same state when they change nothing). `false` when another request changed
   * the booking state since `loaded` was read: nothing was written, and the caller loads and decides again.
   */
  async save(loaded: LoadedBooking, next: BookingState): Promise<boolean> {
    if (next === loaded.state) return true;
    const holds = difference(loaded.state.holds, next.holds, sameHold);
    const sessions = difference(loaded.state.sessions, next.sessions, sameSession);
    const { revision } = loaded;
    const statements: D1StatementLike[] = [
      ...holds.removed.map((h) => this.#db.prepare(`DELETE FROM booking_holds WHERE ${UNCHANGED} AND id = ?2`).bind(revision, h.id)),
      ...sessions.removed.map((s) => this.#db.prepare(`DELETE FROM booking_sessions WHERE ${UNCHANGED} AND id = ?2`).bind(revision, s.id)),
      ...holds.added.map((h) =>
        this.#db
          .prepare(
            `INSERT INTO booking_holds (id, start_at, end_at, technician_id, created_at, expires_at)
             SELECT ?2, ?3, ?4, ?5, ?6, ?7 WHERE ${UNCHANGED}`,
          )
          .bind(revision, h.id, h.start, h.end, h.technicianId, h.createdAt, h.expiresAt),
      ),
      ...sessions.added.map((s) =>
        this.#db
          .prepare(
            `INSERT INTO booking_sessions (id, start_at, end_at, technician_id, confirmed_at)
             SELECT ?2, ?3, ?4, ?5, ?6 WHERE ${UNCHANGED}`,
          )
          .bind(revision, s.id, s.start, s.end, s.technicianId, s.confirmedAt),
      ),
    ];
    if (statements.length === 0) return true;
    statements.push(this.#db.prepare('UPDATE booking_revision SET revision = revision + 1 WHERE id = 1 AND revision = ?1').bind(revision));
    const results = await this.#db.batch(statements);
    return changesOf(results.at(-1)) === 1;
  }

  /** Notes which order a hold (and the session it becomes) belongs to. The first order to claim a booking keeps it. */
  async linkOrder(bookingId: string, orderId: string): Promise<boolean> {
    const result = await this.#db
      .prepare('INSERT INTO booking_orders (booking_id, order_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
      .bind(bookingId, orderId)
      .run();
    return changesOf(result) === 1;
  }

  async orderOf(bookingId: string): Promise<string | undefined> {
    const row = await this.#db.prepare('SELECT order_id FROM booking_orders WHERE booking_id = ?').bind(bookingId).first<{ order_id: string }>();
    return row?.order_id;
  }

  /** The ids of the holds and sessions an order booked. */
  async bookingsOf(orderId: string): Promise<string[]> {
    const result = await this.#db
      .prepare('SELECT booking_id FROM booking_orders WHERE order_id = ? ORDER BY booking_id')
      .bind(orderId)
      .all<{ booking_id: string }>();
    return rowsOf<{ booking_id: string }>(result).map((row) => row.booking_id);
  }
}
