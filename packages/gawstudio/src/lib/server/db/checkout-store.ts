// The checkout's store on D1: `CheckoutStore` (`../checkout/store.ts`) over the tables the other repositories
// already keep, plus one row of its own per order (`checkouts`, migration 0002).
//
// Where a `Checkout` lives:
// - its order and quote: the `orders` tables, written through `OrderRepository`'s own statements, so an order
//   that came through the checkout is an order like any other to the account pages and the queue;
// - its version: the order's `revision` (version = revision + 1). A save is one batch with the order's update,
//   every statement conditional on that revision, so the checkout's row and the order move together or not at
//   all, and `claim` or `anonymise` on the order (which move the revision too) make a save from an older copy
//   fail like any other concurrent write;
// - the customer's address: `orders.email`, kept in one place so that anonymising the order removes it;
// - the booking state: `BookingRepository`, whose revision makes `updateBooking` the serialised point. The
//   change is run again on the fresh state when another request got in between, so it must be pure, as the
//   interface asks;
// - everything else (slot, session, payment record, settlement, refund, alerts): JSON in `checkouts.data`.
//
// Not used from here: the `payments` and `invoices` tables. The checkout keeps its payment's record and its
// invoice's id inside the checkout, under the order's version; `PaymentRepository` and `InvoiceRepository` stay
// for a caller that wants those as rows (reports, an admin list). Whether to mirror them is the wiring's choice.
import type { BookingState } from '../booking/index.ts';
import { isUnfinished } from '../checkout/store.ts';
import type { CheckoutStore } from '../checkout/store.ts';
import { LANGUAGES } from '../checkout/types.ts';
import type { Checkout } from '../checkout/types.ts';
import { BookingRepository } from './booking.ts';
import { changesOf, oneOf, rowsOf } from './d1.ts';
import type { D1Like, D1ResultLike } from './d1.ts';
import { OrderRepository } from './orders.ts';
import type { StoredOrder } from './orders.ts';

interface CheckoutRow {
  order_id: string;
  fingerprint: string;
  customer_name: string;
  language: string;
  unfinished: number;
  data: string;
}

/** The part of a checkout kept as JSON. */
type Data = Pick<Checkout, 'slot' | 'session' | 'payment' | 'redirectUrl' | 'settlement' | 'refund' | 'alerts'>;

const dataOf = ({ slot, session, payment, redirectUrl, settlement, refund, alerts }: Checkout): string =>
  // `undefined` members are left out by JSON, so an absent part comes back absent.
  JSON.stringify({ slot, session, payment, redirectUrl, settlement, refund, alerts } satisfies Data);

function checkoutOf(stored: StoredOrder, row: CheckoutRow): Checkout {
  const data = JSON.parse(row.data) as Data;
  return {
    version: stored.revision + 1,
    fingerprint: row.fingerprint,
    createdAt: stored.createdAt,
    order: stored.order,
    // An anonymised order has no address any more; its checkout is long finished and is only ever read.
    customer: { email: stored.email ?? '', name: row.customer_name, language: oneOf(LANGUAGES, row.language, 'checkouts.language') },
    quote: stored.quote,
    ...data,
  };
}

/** How many times `updateBooking` runs its change before it gives up: every retry means another request won. */
const BOOKING_ATTEMPTS = 8;

export class D1CheckoutStore implements CheckoutStore {
  readonly #db: D1Like;
  readonly #orders: OrderRepository;
  readonly #bookings: BookingRepository;
  readonly #sessionsEndingAfter: (() => number) | undefined;

  /**
   * `sessionsEndingAfter` spares reading the sessions that are over: give it the clock (less a margin), since no
   * transition looks at a finished session. Left out, the whole booking state is read every time.
   */
  constructor(db: D1Like, { sessionsEndingAfter }: { sessionsEndingAfter?: () => number } = {}) {
    this.#db = db;
    this.#orders = new OrderRepository(db);
    this.#bookings = new BookingRepository(db);
    this.#sessionsEndingAfter = sessionsEndingAfter;
  }

  #load() {
    return this.#bookings.load(this.#sessionsEndingAfter?.());
  }

  async booking(): Promise<BookingState> {
    return (await this.#load()).state;
  }

  async updateBooking<T>(change: (state: BookingState) => { state: BookingState; result: T }): Promise<T> {
    for (let attempt = 0; attempt < BOOKING_ATTEMPTS; attempt++) {
      const loaded = await this.#load();
      const { state, result } = change(loaded.state);
      if (await this.#bookings.save(loaded, state)) return result;
    }
    throw new Error(`db: the booking state kept changing under ${BOOKING_ATTEMPTS} attempts to update it`);
  }

  async get(orderId: string): Promise<Checkout | undefined> {
    return (await this.#select('id = ?', [orderId], 'order_id = ?'))[0];
  }

  async insert(checkout: Checkout): Promise<boolean> {
    const { order, quote, customer } = checkout;
    if (checkout.version !== 1) throw new RangeError('db: a new checkout is at version 1');
    const stored: StoredOrder = { order, quote, accountId: null, email: customer.email, createdAt: checkout.createdAt, revision: 0 };
    try {
      await this.#db.batch([
        ...this.#orders.insertStatements(stored),
        this.#db
          .prepare('INSERT INTO checkouts (order_id, fingerprint, customer_name, language, unfinished, data) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(order.id, checkout.fingerprint, customer.name, customer.language, isUnfinished(checkout) ? 1 : 0, dataOf(checkout)),
      ]);
    } catch (error) {
      // The id is taken (the batch rolled back whole): that is the answer `false`. Anything else is an error.
      if (await this.#db.prepare('SELECT 1 AS taken FROM orders WHERE id = ?').bind(order.id).first()) return false;
      throw error;
    }
    return true;
  }

  async save(checkout: Checkout): Promise<Checkout | undefined> {
    const { order, quote, customer } = checkout;
    const revision = checkout.version - 1;
    // The owner columns are kept as stored: the account is `claim`'s to set, and the address was set on insert.
    const statements = this.#orders.updateStatements({ order, quote, accountId: null, email: null, createdAt: checkout.createdAt, revision }, { keepOwner: true });
    const moveRevision = statements.pop()!;
    const results = await this.#db.batch([
      ...statements,
      this.#db
        .prepare(
          `UPDATE checkouts SET fingerprint = ?3, customer_name = ?4, language = ?5, unfinished = ?6, data = ?7
           WHERE order_id = ?1 AND EXISTS (SELECT 1 FROM orders WHERE id = ?1 AND revision = ?2)`,
        )
        .bind(order.id, revision, checkout.fingerprint, customer.name, customer.language, isUnfinished(checkout) ? 1 : 0, dataOf(checkout)),
      moveRevision,
    ]);
    return changesOf(results.at(-1)) === 1 ? { ...checkout, version: checkout.version + 1 } : undefined;
  }

  unfinished(): Promise<Checkout[]> {
    return this.#select('id IN (SELECT order_id FROM checkouts WHERE unfinished = 1)', [], 'unfinished = 1');
  }

  /** How many checkouts there are. */
  async count(): Promise<number> {
    return (await this.#db.prepare('SELECT COUNT(*) AS n FROM checkouts').first<{ n: number }>())?.n ?? 0;
  }

  /**
   * Removes what names the customer from the checkout's own row, for an order that is being anonymised
   * (`OrderRepository.anonymise` removes the address and the company): the name, and the fingerprint, which
   * holds the request's address and name. `false` when the order has no checkout.
   */
  async anonymise(orderId: string): Promise<boolean> {
    const result = await this.#db.prepare(`UPDATE checkouts SET customer_name = '', fingerprint = '' WHERE order_id = ?`).bind(orderId).run();
    return changesOf(result) === 1;
  }

  /** Whole checkouts in one batch: the orders matching `orders`, and their rows matching `rows`, read together. */
  async #select(orders: string, params: string[], rows: string): Promise<Checkout[]> {
    const results: D1ResultLike[] = await this.#db.batch([
      ...this.#orders.selectStatements(orders, params),
      this.#db.prepare(`SELECT * FROM checkouts WHERE ${rows}`).bind(...params),
    ]);
    const rowOf = new Map(rowsOf<CheckoutRow>(results.at(-1)).map((row) => [row.order_id, row]));
    return this.#orders.assemble(results.slice(0, -1)).flatMap((stored) => {
      const row = rowOf.get(stored.order.id);
      return row ? [checkoutOf(stored, row)] : [];
    });
  }
}
