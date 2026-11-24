// What the checkout needs kept, and the in-memory store the tests run on. The database (or Durable Object) is
// the caller's; the comments say which operations must be atomic there.
import { EMPTY_STATE } from '../booking/index.ts';
import type { BookingState } from '../booking/index.ts';
import { isFinal } from '../orders/index.ts';
import type { Checkout } from './types.ts';

export interface CheckoutStore {
  /** The booking state as it is now, for reading what is offered. Never write what was read here: use `updateBooking`. */
  booking(): Promise<BookingState>;

  /**
   * Applies a pure change to the booking state and stores the result, atomically: no other change may run
   * between the read and the write. This is the serialised point that makes one slot impossible to pay twice.
   *
   * `ids` names the holds and sessions the change looks up by id (`hold`, `confirm`, `confirmLate`). A store
   * that leaves sessions which are over out of the state it reads must still read the sessions with these ids,
   * whenever they ended: an id is unique for good, and confirming again returns the session it gave.
   */
  updateBooking<T>(change: (state: BookingState) => { state: BookingState; result: T }, options?: { ids?: readonly string[] }): Promise<T>;

  get(orderId: string): Promise<Checkout | undefined>;

  /** Stores a new checkout unless its order id is taken (a unique key): `false` then. */
  insert(checkout: Checkout): Promise<boolean>;

  /**
   * Stores a changed checkout if the stored one still has the `version` this copy was read with, atomically
   * (`UPDATE … WHERE version = ?`), and returns it with the next version; `undefined` when someone else saved
   * first. Two deliveries of one notification cannot both act on an order because of this.
   */
  save(checkout: Checkout): Promise<Checkout | undefined>;

  /** Every checkout `isUnfinished` holds for: what the sweep looks through. */
  unfinished(): Promise<Checkout[]>;
}

/**
 * Whether a checkout may still need something: its order is not in a final state, a paid order's settlement is
 * not done, or a refund is still to be made. A database keeps this as an indexed column, set on every save.
 */
export function isUnfinished(checkout: Checkout): boolean {
  return !isFinal(checkout.order) || (checkout.settlement !== undefined && !checkout.settlement.done) || checkout.refund?.state === 'pending';
}

export class MemoryCheckoutStore implements CheckoutStore {
  readonly checkouts = new Map<string, Checkout>();
  state: BookingState = EMPTY_STATE;

  async booking() {
    return this.state;
  }

  async updateBooking<T>(change: (state: BookingState) => { state: BookingState; result: T }, _options?: { ids?: readonly string[] }) {
    // Keeps every session, so `ids` needs no extra reading. Read, changed and written without an `await` between: one tick, as a Durable Object's single thread.
    const { state, result } = change(this.state);
    this.state = state;
    return result;
  }

  async get(orderId: string) {
    const found = this.checkouts.get(orderId);
    return found && structuredClone(found);
  }

  async insert(checkout: Checkout) {
    if (this.checkouts.has(checkout.order.id)) return false;
    this.checkouts.set(checkout.order.id, structuredClone(checkout));
    return true;
  }

  async save(checkout: Checkout) {
    const stored = this.checkouts.get(checkout.order.id);
    if (!stored || stored.version !== checkout.version) return undefined;
    const next = structuredClone({ ...checkout, version: checkout.version + 1 });
    this.checkouts.set(checkout.order.id, next);
    return structuredClone(next);
  }

  async unfinished() {
    return [...this.checkouts.values()].filter(isUnfinished).map((each) => structuredClone(each));
  }
}
