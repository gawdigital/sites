// What is the D1 store's own: where a checkout's parts land, and what the other repositories do to it. Its
// behaviour as a `CheckoutStore` is tested by the checkout's own tests, which run on it (`../checkout`).
import { describe, expect, test } from 'bun:test';

import { confirm, confirmLate, hold } from '../booking/index.ts';
import { handlePaymentNotification, isUnfinished, startCheckout } from '../checkout/index.ts';
import type { Checkout } from '../checkout/index.ts';
import { MINUTE, MORNING, NOW, recordingCart, studio, tracksCart } from '../checkout/testing.ts';
import { BookingRepository } from './booking.ts';
import { D1CheckoutStore } from './checkout-store.ts';
import { OrderRepository } from './orders.ts';
import { memoryD1 } from './testing.ts';
import type { MemoryD1 } from './testing.ts';

const DAY_MS = 24 * 60 * MINUTE;

/** A studio on a database the test can look into. */
async function onD1(): Promise<{ db: MemoryD1; store: D1CheckoutStore; s: ReturnType<typeof studio> }> {
  const db = memoryD1();
  const store = new D1CheckoutStore(db);
  const s = studio();
  s.deps.store = store;
  return { db, store, s };
}

async function stored(store: D1CheckoutStore, orderId: string): Promise<Checkout> {
  const found = await store.get(orderId);
  if (!found) throw new Error(`no order ${orderId}`);
  return found;
}

const pay = async (s: ReturnType<typeof studio>, store: D1CheckoutStore, orderId: string) => {
  const paymentId = (await stored(store, orderId)).payment!.paymentId;
  s.payments.settle(paymentId, 'paid');
  return handlePaymentNotification(s.deps, s.payments.notification(paymentId));
};

describe('a checkout on D1', () => {
  test('is an order like any other to the order repository, and its hold a row of the booking', async () => {
    const { db, store, s } = await onD1();
    await startCheckout(s.deps, recordingCart('order-rec-1'));

    const order = await new OrderRepository(db).get('order-rec-1');
    expect(order).toMatchObject({ order: { id: 'order-rec-1', flow: 'recording', state: 'awaiting-payment' }, email: 'name@example.com', accountId: null, createdAt: NOW, revision: 1 });
    expect(order?.quote.total).toBe(387_200);
    expect((await new BookingRepository(db).load()).state.holds.map((held) => held.id)).toEqual(['order-rec-1']);

    const checkout = await stored(store, 'order-rec-1');
    // Inserted at version 1, saved once with its payment.
    expect(checkout.version).toBe(2);
    expect(checkout).toMatchObject({ createdAt: NOW, customer: { email: 'name@example.com', name: 'Jane Doe', language: 'en' }, slot: { ...MORNING, kind: 'block' }, payment: { status: 'pending' }, alerts: [] });
    expect('settlement' in checkout).toBe(false);
    expect(db.sqlite.query('SELECT order_id, unfinished FROM checkouts').all()).toEqual([{ order_id: 'order-rec-1', unfinished: 1 }]);
  });

  test('an id that is taken is not inserted, and a save from an older copy is refused', async () => {
    const { store, s } = await onD1();
    await startCheckout(s.deps, tracksCart('order-mix-1'));
    const first = await stored(store, 'order-mix-1');

    expect(await store.insert({ ...first, version: 1 })).toBe(false);
    expect(await store.count()).toBe(1);

    const saved = await store.save({ ...first, alerts: ['one'] });
    expect(saved?.version).toBe(first.version + 1);
    expect(await store.save({ ...first, alerts: ['two'] })).toBeUndefined();
    expect((await stored(store, 'order-mix-1')).alerts).toEqual(['one']);
    expect(await store.save({ ...first, order: { ...first.order, id: 'order-none-1' } })).toBeUndefined();
  });

  test('a claim by an account is kept by the next save, and makes a save from before it wait its turn', async () => {
    const { db, store, s } = await onD1();
    await startCheckout(s.deps, tracksCart('order-mix-1'));
    const before = await stored(store, 'order-mix-1');
    db.sqlite.run(`INSERT INTO accounts (id, email, created_at) VALUES ('acc-1', 'name@example.com', ${NOW})`);
    const orders = new OrderRepository(db);
    expect(await orders.claim('name@example.com', 'acc-1')).toBe(1);

    expect(await store.save({ ...before, alerts: ['stale'] })).toBeUndefined();
    expect((await pay(s, store, 'order-mix-1')).ok).toBe(true);
    expect(await orders.get('order-mix-1')).toMatchObject({ accountId: 'acc-1', email: 'name@example.com', order: { state: 'awaiting-files' } });
  });

  test('lists what is unfinished, and only that', async () => {
    const { db, store, s } = await onD1();
    await startCheckout(s.deps, tracksCart('order-mix-1'));
    await startCheckout(s.deps, recordingCart('order-rec-1'));
    s.clock.now += MINUTE;
    const cancelled = (await stored(store, 'order-rec-1')).payment!.paymentId;
    s.payments.settle(cancelled, 'cancelled');
    await handlePaymentNotification(s.deps, s.payments.notification(cancelled));

    const unfinished = await store.unfinished();
    expect(unfinished.map((checkout) => checkout.order.id)).toEqual(['order-mix-1']);
    expect(unfinished.every(isUnfinished)).toBe(true);
    expect(isUnfinished(await stored(store, 'order-rec-1'))).toBe(false);
    expect(db.sqlite.query('SELECT order_id FROM checkouts WHERE unfinished = 1').all()).toEqual([{ order_id: 'order-mix-1' }]);
  });

  test('a change to the booking is run again on the fresh state when another request got in between', async () => {
    const { db, store, s } = await onD1();
    const context = await s.deps.booking();
    const other = new BookingRepository(db);
    let runs = 0;
    const result = await store.updateBooking((state) => {
      runs++;
      const outcome = hold(state, { id: 'order-rec-2', ...MORNING }, context, NOW);
      return { state: outcome.state, result: outcome.ok };
    });
    expect(result).toBe(true);

    // Another request takes the afternoon between this one's read and its write.
    const loaded = await other.load();
    const afternoon = { ...MORNING, start: MORNING.start + 5 * 60 * MINUTE, end: MORNING.end + 5 * 60 * MINUTE };
    runs = 0;
    let interfered = false;
    const second = await store.updateBooking((state) => {
      runs++;
      if (!interfered) {
        interfered = true;
        const theirs = hold(loaded.state, { id: 'order-rec-3', ...afternoon }, context, NOW);
        // Synchronous under the shim: stored before this change's own write is attempted.
        void other.save(loaded, theirs.state);
      }
      const outcome = hold(state, { id: 'order-rec-4', ...afternoon }, context, NOW);
      return { state: outcome.state, result: outcome.ok };
    });
    expect(runs).toBe(2);
    expect(second).toBe(false);
    expect((await store.booking()).holds.map((held) => held.id).sort()).toEqual(['order-rec-2', 'order-rec-3']);
  });

  test('a session left out of the load because it is over still holds its id', async () => {
    const db = memoryD1();
    const clock = { now: NOW };
    const store = new D1CheckoutStore(db, { sessionsEndingAfter: () => clock.now });
    const s = studio();
    const context = await s.deps.booking();
    const request = { id: 'order-rec-1', ...MORNING };
    const confirmed = await store.updateBooking(
      (state) => {
        const held = hold(state, request, context, NOW);
        const outcome = confirm(held.state, request.id, context, NOW);
        return { state: outcome.state, result: outcome };
      },
      { ids: [request.id] },
    );
    expect(confirmed.ok).toBe(true);

    // The session is over and no longer part of a load; a week later its id is asked for again.
    clock.now = MORNING.end + 7 * DAY_MS;
    expect((await store.booking()).sessions).toEqual([]);
    const later = { id: request.id, start: MORNING.start + 14 * DAY_MS, end: MORNING.end + 14 * DAY_MS, technicianId: null };
    const again = await store.updateBooking((state) => {
      const outcome = hold(state, later, context, clock.now);
      return { state: outcome.state, result: outcome };
    }, { ids: [request.id] });
    expect(again).toMatchObject({ ok: false, reason: 'duplicate-id' });

    // Confirming it again (a notification delivered once more) is the same session, not a refusal.
    const reconfirmed = await store.updateBooking((state) => {
      const outcome = confirmLate(state, request, context, clock.now);
      return { state: outcome.state, result: outcome };
    }, { ids: [request.id] });
    expect(reconfirmed).toMatchObject({ ok: true, late: false, session: { id: request.id, start: MORNING.start } });
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM booking_holds').get()).toEqual({ n: 0 });
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM booking_sessions').get()).toEqual({ n: 1 });
  });

  test('anonymising removes what names the customer from both rows; the order and its amounts stay', async () => {
    const { db, store, s } = await onD1();
    await startCheckout(s.deps, { ...tracksCart('order-mix-1'), company: { name: 'Example Ltd' } });
    await pay(s, store, 'order-mix-1');

    expect(await new OrderRepository(db).anonymise('order-mix-1')).toBe(true);
    expect(await store.anonymise('order-mix-1')).toBe(true);
    expect(await store.anonymise('order-none-1')).toBe(false);
    const checkout = await stored(store, 'order-mix-1');
    expect(checkout).toMatchObject({ fingerprint: '', customer: { email: '', name: '', language: 'en' }, order: { state: 'awaiting-files' }, payment: { status: 'paid' } });
    expect(checkout.quote.total).toBe(48_400);
    expect(JSON.stringify(db.sqlite.query('SELECT * FROM checkouts').all())).not.toContain('example.com');
  });
});
