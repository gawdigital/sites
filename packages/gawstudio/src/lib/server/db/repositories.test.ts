import { describe, expect, test } from 'bun:test';

import { confirm, DEFAULT_SETTINGS, EMPTY_STATE, expire, hold, release } from '../booking/index.ts';
import type { BookingContext, HoldRequest } from '../booking/index.ts';
import { between } from '../booking/testing.ts';
import { advance, DEFAULT_FILE_SETTINGS, initiate, MiB, orderBytes } from '../files/index.ts';
import type { FileRef, UploadRecord } from '../files/index.ts';
import type { InvoiceDocument } from '../invoicing/index.ts';
import { createOrder, EXAMPLE_CATALOGUE, quote, transition } from '../orders/index.ts';
import type { Flow, Order, OrderState, Quote } from '../orders/index.ts';
import { applyPaymentEvent, newPaymentRecord, noteRefund } from '../payments/index.ts';
import type { PaymentEvent, PaymentRecord, PaymentStatus } from '../payments/index.ts';
import { BookingRepository } from './booking.ts';
import { InvoiceRepository } from './invoices.ts';
import { OrderRepository } from './orders.ts';
import type { StoredOrder } from './orders.ts';
import { PaymentRepository } from './payments.ts';
import { memoryD1 } from './testing.ts';
import type { MemoryD1 } from './testing.ts';
import { UploadRepository } from './uploads.ts';

const T0 = Date.parse('2026-05-20T08:00:00.000Z');
const EMAIL = 'name@example.com';

function priced(request: Parameters<typeof quote>[1], catalogue = EXAMPLE_CATALOGUE): Quote {
  const result = quote(catalogue, request);
  if (!result.ok) throw new Error(`no quote: ${JSON.stringify(result.errors)}`);
  return result.quote;
}

/** Five mixes and a mastering for a company: service lines, a discount line and two work items. */
const MIXES = priced({
  currency: 'EUR',
  tracks: [
    { service: 'mix', technician: 'libor', tracks: 5 },
    { service: 'mastering', technician: 'risto', tracks: 1 },
  ],
  company: { name: 'Example s.r.o.', vatId: 'CZ00000000' },
});
/** A free window of an hour and a half: a fractional quantity, in crowns, and nothing for the queue. */
const RECORDING = priced(
  { currency: 'CZK', recording: [{ type: 'window', minutes: 90 }] },
  { ...EXAMPLE_CATALOGUE, recording: { ...EXAMPLE_CATALOGUE.recording!, windowStepMinutes: 30 } },
);

const anOrder = (id: string, flow: Flow = 'classic', q: Quote = MIXES, over: Partial<StoredOrder> = {}): StoredOrder => ({
  order: createOrder(id, flow, new Date(T0)),
  quote: q,
  accountId: null,
  email: EMAIL,
  createdAt: T0,
  revision: 0,
  ...over,
});

function moved(order: Order, to: OrderState, at: number): Order {
  const result = transition(order, to, new Date(at));
  if (!result.ok) throw new Error(`${order.state} -> ${to} is not allowed`);
  return result.order;
}

function addAccount(db: MemoryD1, id: string, email = EMAIL): void {
  db.sqlite.run('INSERT INTO accounts (id, email, created_at) VALUES (?, ?, ?)', [id, email, T0]);
}

describe('orders', () => {
  test('an order comes back as it was saved: lifecycle, lines, totals, work, company', async () => {
    const db = memoryD1();
    const orders = new OrderRepository(db);
    expect(MIXES.lines.map((l) => l.type)).toEqual(['service', 'discount', 'service']);
    await orders.insert(anOrder('ord-1'));
    await orders.insert(anOrder('ord-2', 'recording', RECORDING, { email: 'other@example.com', createdAt: T0 + 1 }));

    expect(await orders.get('ord-1')).toEqual(anOrder('ord-1'));
    const recording = await orders.get('ord-2');
    expect(recording).toEqual(anOrder('ord-2', 'recording', RECORDING, { email: 'other@example.com', createdAt: T0 + 1 }));
    expect(recording?.quote.lines[0]?.quantity).toBe(1.5);
    expect(recording?.quote).not.toHaveProperty('company');
    expect(recording?.order).not.toHaveProperty('deliveredAt');
    expect(await orders.get('ord-3')).toBeUndefined();
  });

  test('money is stored in minor units and times in milliseconds', async () => {
    const db = memoryD1();
    await new OrderRepository(db).insert(anOrder('ord-1'));
    expect(db.sqlite.query('SELECT state_since, created_at, subtotal, vat, total, currency, typeof(total) AS type FROM orders').get()).toEqual({
      state_since: T0,
      created_at: T0,
      subtotal: MIXES.subtotal,
      vat: MIXES.vat,
      total: MIXES.total,
      currency: 'EUR',
      type: 'integer',
    });
    expect(db.sqlite.query('SELECT SUM(amount) AS sum FROM order_lines').get()).toEqual({ sum: MIXES.subtotal });
  });

  test('an id is taken once, and a refused insert stores nothing of the order', async () => {
    const db = memoryD1();
    const orders = new OrderRepository(db);
    await orders.insert(anOrder('ord-1'));
    await expect(orders.insert(anOrder('ord-1', 'recording', RECORDING))).rejects.toThrow(/UNIQUE/);
    expect(await orders.get('ord-1')).toEqual(anOrder('ord-1'));
  });

  test('a transition is written with its history, and the revision moves on', async () => {
    const orders = new OrderRepository(memoryD1());
    await orders.insert(anOrder('ord-1'));
    let stored = (await orders.get('ord-1'))!;
    const steps: OrderState[] = ['awaiting-payment', 'paid', 'in-queue', 'in-progress', 'delivered'];
    for (const [i, to] of steps.entries()) {
      const order = { ...moved(stored.order, to, T0 + (i + 1) * 1000), expectedDelivery: '2026-06-01' };
      expect(await orders.update({ ...stored, order })).toBe(true);
      stored = (await orders.get('ord-1'))!;
      expect(stored.order).toEqual(order);
      expect(stored.revision).toBe(i + 1);
    }
    expect(stored.order.history.map((h) => h.state)).toEqual(['draft', ...steps]);
    expect(stored.order.deliveredAt).toBe(new Date(T0 + 5000).toISOString());
    expect(stored.quote).toEqual(MIXES);
  });

  test('of two requests that read the same order, one writes; the other changes nothing', async () => {
    const db = memoryD1();
    const orders = new OrderRepository(db);
    await orders.insert(anOrder('ord-1'));
    const read = (await orders.get('ord-1'))!;
    const pay = { ...read, order: moved(read.order, 'awaiting-payment', T0 + 1000) };
    const cancel = { ...read, order: moved(read.order, 'cancelled', T0 + 2000), quote: RECORDING };

    expect(await Promise.all([orders.update(pay), orders.update(cancel)])).toEqual([true, false]);
    const after = (await orders.get('ord-1'))!;
    expect(after).toEqual({ ...pay, revision: 1 });
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM order_history').get()).toEqual({ n: 2 });
    expect(await orders.update(anOrder('ord-9'))).toBe(false);
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM orders').get()).toEqual({ n: 1 });
  });

  test('a requote replaces the lines and the work', async () => {
    const db = memoryD1();
    const orders = new OrderRepository(db);
    await orders.insert(anOrder('ord-1'));
    const read = (await orders.get('ord-1'))!;
    const single = priced({ currency: 'EUR', tracks: [{ service: 'mix', technician: 'nero', tracks: 1 }] });
    expect(await orders.update({ ...read, quote: single })).toBe(true);
    expect((await orders.get('ord-1'))?.quote).toEqual(single);
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM order_lines').get()).toEqual({ n: 1 });
  });

  test('orders are listed by account, by address and by state, whole, in one query each', async () => {
    const db = memoryD1();
    addAccount(db, 'acc-1');
    const orders = new OrderRepository(db);
    await orders.insert(anOrder('ord-1', 'classic', MIXES, { accountId: 'acc-1' }));
    await orders.insert(anOrder('ord-2', 'recording', RECORDING, { createdAt: T0 + 1 }));
    await orders.insert(anOrder('ord-3', 'classic', MIXES, { email: 'other@example.com', createdAt: T0 + 2 }));
    const second = (await orders.get('ord-2'))!;
    await orders.update({ ...second, order: moved(second.order, 'awaiting-payment', T0 + 5) });

    const before = db.queries();
    const mine = await orders.ofAccount('acc-1');
    expect(db.queries() - before).toBe(1);
    expect(mine).toEqual([anOrder('ord-1', 'classic', MIXES, { accountId: 'acc-1' })]);
    expect((await orders.ofEmail(EMAIL)).map((o) => o.order.id)).toEqual(['ord-1', 'ord-2']);
    expect((await orders.inStates(['draft'])).map((o) => o.order.id)).toEqual(['ord-1', 'ord-3']);
    const listed = await orders.inStates(['draft', 'awaiting-payment']);
    expect(listed.map((o) => o.order.id)).toEqual(['ord-1', 'ord-2', 'ord-3']);
    expect(listed[1]?.quote).toEqual(RECORDING);
    expect(listed[1]?.order.history).toHaveLength(2);
    expect(await orders.inStates([])).toEqual([]);
  });

  test('an account claims the orders of its address; anonymising removes everything that names the customer', async () => {
    const db = memoryD1();
    addAccount(db, 'acc-1');
    addAccount(db, 'acc-2', 'other@example.com');
    const orders = new OrderRepository(db);
    await orders.insert(anOrder('ord-1'));
    await orders.insert(anOrder('ord-2', 'classic', MIXES, { accountId: 'acc-2' }));
    expect(await orders.claim(EMAIL, 'acc-1')).toBe(1);
    expect((await orders.ofAccount('acc-1')).map((o) => o.order.id)).toEqual(['ord-1']);
    expect((await orders.get('ord-2'))?.accountId).toBe('acc-2');

    const stale = (await orders.get('ord-1'))!;
    expect(await orders.anonymise('ord-1')).toBe(true);
    expect(await orders.anonymise('ord-9')).toBe(false);
    const after = (await orders.get('ord-1'))!;
    expect(after).toMatchObject({ accountId: null, email: null, order: stale.order });
    expect(after.quote).toEqual({ ...MIXES, company: undefined } as Quote);
    expect(JSON.stringify(db.sqlite.query("SELECT * FROM orders WHERE id = 'ord-1'").all())).not.toMatch(/example|CZ0/i);
    // A request that read the order before cannot write the customer back.
    expect(await orders.update(stale)).toBe(false);
  });

  test('a stored state the code does not know is an error', async () => {
    const db = memoryD1();
    const orders = new OrderRepository(db);
    await orders.insert(anOrder('ord-1'));
    db.sqlite.run("UPDATE orders SET state = 'lost'");
    await expect(orders.get('ord-1')).rejects.toThrow(/orders\.state/);
  });
});

describe('payments', () => {
  const amount = { amount: 121_00, currency: 'EUR' };
  const event = (status: PaymentStatus, over: Partial<PaymentEvent> = {}): PaymentEvent => ({
    provider: 'comgate',
    paymentId: 'pay-1',
    reference: 'ord-1',
    status,
    amount,
    test: false,
    ...over,
  });

  async function created(): Promise<{ payments: PaymentRepository; record: PaymentRecord; db: MemoryD1 }> {
    const db = memoryD1();
    const payments = new PaymentRepository(db);
    const record = newPaymentRecord('comgate', 'pay-1', 'ord-1', amount, T0);
    expect(await payments.insert(record)).toBe(true);
    return { payments, record, db };
  }

  test('the method and the refunded amount are kept, with the status and without it moving', async () => {
    const { payments, record, db } = await created();
    const paid = applyPaymentEvent(record, event('paid', { method: 'CARD_CZ_CSOB_2' }), T0 + 1000);
    expect(await payments.apply(record, paid)).toBe(true);
    expect(await payments.get('comgate', 'pay-1')).toEqual({ ...record, status: 'paid', updatedAt: T0 + 1000, method: 'CARD_CZ_CSOB_2' });

    const refunded = noteRefund(paid.record, amount.amount);
    expect(await payments.note(refunded)).toBe(true);
    expect(await payments.get('comgate', 'pay-1')).toEqual(refunded);
    expect(db.sqlite.query('SELECT status, updated_at, effect, refunded FROM payments').get()).toEqual({ status: 'paid', updated_at: T0 + 1000, effect: 'confirm', refunded: amount.amount });
    expect(await payments.note({ ...refunded, paymentId: 'pay-9' })).toBe(false);

    const noted = applyPaymentEvent(record, event('pending', { method: 'BANK_CZ_RB' }), T0 + 5);
    expect(noted.outcome).toBe('noted');
    expect(await payments.apply(record, noted)).toBe(false);
  });

  test('a payment comes back as it was created, and is created once', async () => {
    const { payments, record } = await created();
    expect(await payments.get('comgate', 'pay-1')).toEqual(record);
    expect(await payments.insert({ ...record, amount: { amount: 1, currency: 'CZK' } })).toBe(false);
    expect(await payments.get('comgate', 'pay-1')).toEqual(record);
    expect(await payments.get('other', 'pay-1')).toBeUndefined();
    await payments.insert(newPaymentRecord('comgate', 'pay-2', 'ord-1', amount, T0 + 1));
    expect((await payments.ofReference('ord-1')).map((p) => p.paymentId)).toEqual(['pay-1', 'pay-2']);
  });

  test('the same notification delivered twice at once confirms the booking once', async () => {
    const { payments, record } = await created();
    const transitions = [1, 2].map((i) => applyPaymentEvent(record, event('paid'), T0 + i * 1000));
    expect(transitions.map((t) => t.effect)).toEqual(['confirm', 'confirm']);
    const won = await Promise.all(transitions.map((t) => payments.apply(record, t)));
    expect(won).toEqual([true, false]);
    expect(await payments.get('comgate', 'pay-1')).toEqual({ ...record, status: 'paid', updatedAt: T0 + 1000 });

    // Delivered again later: the stored record makes it a duplicate, and nothing is written.
    const stored = (await payments.get('comgate', 'pay-1'))!;
    const again = applyPaymentEvent(stored, event('paid'), T0 + 9000);
    expect(again.outcome).toBe('duplicate');
    expect(await payments.apply(stored, again)).toBe(false);
    expect((await payments.get('comgate', 'pay-1'))?.updatedAt).toBe(T0 + 1000);
  });

  test('an effect is owed from the moment the status is written until it is marked done', async () => {
    const { payments, record } = await created();
    const authorised = applyPaymentEvent(record, event('authorised'), T0 + 1000);
    expect(await payments.apply(record, authorised)).toBe(true);
    expect(await payments.owedEffects(T0 + 60_000)).toEqual([]);

    const paid = applyPaymentEvent(authorised.record, event('paid'), T0 + 2000);
    expect(await payments.apply(authorised.record, paid)).toBe(true);
    expect(await payments.owedEffects(T0 + 1999)).toEqual([]);
    expect(await payments.owedEffects(T0 + 2000)).toEqual([{ record: paid.record, effect: 'confirm' }]);

    await payments.effectDone('comgate', 'pay-1', T0 + 3000);
    expect(await payments.owedEffects(T0 + 60_000)).toEqual([]);
    expect(await payments.get('comgate', 'pay-1')).toEqual(paid.record);
  });

  test('a cancelled payment owes a release; a mismatched event writes nothing', async () => {
    const { payments, record, db } = await created();
    const wrong = applyPaymentEvent(record, event('paid', { amount: { amount: 1, currency: 'EUR' } }), T0 + 1000);
    expect(wrong.outcome).toBe('amount_mismatch');
    expect(await payments.apply(record, wrong)).toBe(false);
    const cancelled = applyPaymentEvent(record, event('cancelled'), T0 + 2000);
    expect(await payments.apply(record, cancelled)).toBe(true);
    expect(await payments.owedEffects(T0 + 60_000)).toEqual([{ record: cancelled.record, effect: 'release' }]);
    expect(db.sqlite.query('SELECT amount, currency, created_at, updated_at FROM payments').get()).toEqual({
      amount: 121_00,
      currency: 'EUR',
      created_at: T0,
      updated_at: T0 + 2000,
    });
  });
});

describe('invoice references', () => {
  const invoice: InvoiceDocument = {
    id: '501',
    kind: 'invoice',
    number: '2026-0001',
    reference: 'ord-1',
    paid: false,
    total: { amount: 121_00, currency: 'EUR' },
    publicUrl: 'https://invoices.example/501',
  };
  const correction: InvoiceDocument = {
    id: '502',
    kind: 'correction',
    number: '2026-0002',
    reference: 'refund-1',
    paid: false,
    total: { amount: -121_00, currency: 'EUR' },
    publicUrl: 'https://invoices.example/502',
    correctsInvoiceId: '501',
  };

  async function withOrder(): Promise<{ invoices: InvoiceRepository; db: MemoryD1; orders: OrderRepository }> {
    const db = memoryD1();
    const orders = new OrderRepository(db);
    await orders.insert(anOrder('ord-1'));
    await orders.insert(anOrder('ord-2'));
    return { invoices: new InvoiceRepository(db, 'fakturoid'), db, orders };
  }

  test('an order’s documents come back as issued, the invoice first, and are brought up to date', async () => {
    const { invoices } = await withOrder();
    expect(await invoices.save('ord-1', correction, T0)).toBe(true);
    expect(await invoices.save('ord-1', invoice, T0 + 1)).toBe(true);
    expect(await invoices.ofOrder('ord-1')).toEqual([invoice, correction]);
    expect(await invoices.byReference('invoice', 'ord-1')).toEqual(invoice);
    expect(await invoices.byReference('correction', 'ord-1')).toBeUndefined();

    expect(await invoices.save('ord-1', { ...invoice, paid: true }, T0 + 2)).toBe(true);
    expect(await invoices.get('501')).toEqual({ ...invoice, paid: true });
    expect(await invoices.ofOrder('ord-2')).toEqual([]);
  });

  test('an order has one invoice: a second document for the reference is refused', async () => {
    const { invoices, db } = await withOrder();
    await invoices.save('ord-1', invoice, T0);
    expect(await invoices.save('ord-1', { ...invoice, id: '777' }, T0 + 1)).toBe(false);
    expect(await invoices.save('ord-2', invoice, T0 + 1)).toBe(false);
    expect(await invoices.ofOrder('ord-1')).toEqual([invoice]);
    // Another provider's ids are another namespace.
    expect(await new InvoiceRepository(db, 'other').get('501')).toBeUndefined();
  });

  test('an order with an invoice cannot be deleted, and a document needs its order', async () => {
    const { invoices, db } = await withOrder();
    await invoices.save('ord-1', invoice, T0);
    expect(() => db.sqlite.run("DELETE FROM orders WHERE id = 'ord-1'")).toThrow(/FOREIGN KEY/);
    await expect(invoices.save('ord-9', { ...invoice, id: '900', reference: 'ord-9' }, T0)).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe('the booking state', () => {
  const DAY = '2026-06-01';
  const MORNING = between(DAY, '09:00', '13:00');
  const AFTERNOON = between(DAY, '14:00', '18:00');
  const CONTEXT: BookingContext = { settings: DEFAULT_SETTINGS, calendar: [], technicians: [{ id: 'anna', busy: [] }, { id: 'ben', busy: [] }] };
  const request = (id: string, slot = MORNING, technicianId: string | null = null): HoldRequest => ({ id, ...slot, technicianId });

  /** The protocol of `booking.ts`: load, decide, save, and again when another request was first. */
  async function holding(bookings: BookingRepository, each: HoldRequest, now: number) {
    for (;;) {
      const loaded = await bookings.load(now);
      const outcome = hold(loaded.state, each, CONTEXT, now);
      if (await bookings.save(loaded, outcome.state)) return outcome;
    }
  }

  test('an empty database is the empty state', async () => {
    expect(await new BookingRepository(memoryD1()).load()).toEqual({ state: EMPTY_STATE, revision: 0 });
  });

  test('holds and sessions come back as the state machine made them', async () => {
    const bookings = new BookingRepository(memoryD1());
    const first = await holding(bookings, request('a', MORNING, 'anna'), T0);
    const second = await holding(bookings, request('b', AFTERNOON), T0 + 1000);
    expect(first.ok && second.ok).toBe(true);
    const held = await bookings.load();
    expect(held).toEqual({ state: second.state, revision: 2 });

    const confirmed = confirm(held.state, 'a', CONTEXT, T0 + 2000);
    expect(await bookings.save(held, confirmed.state)).toBe(true);
    const after = await bookings.load();
    expect(after.state).toEqual(confirmed.state);
    expect(after.state.sessions).toEqual([{ id: 'a', ...MORNING, technicianId: 'anna', confirmedAt: T0 + 2000 }]);
    expect(after.state.holds.map((h) => h.id)).toEqual(['b']);

    const freed = release(after.state, 'b');
    expect(await bookings.save(after, freed)).toBe(true);
    expect((await bookings.load()).state).toEqual(freed);
  });

  test('two customers taking the same slot at the same moment: one holds it, the other is refused', async () => {
    const db = memoryD1();
    const bookings = new BookingRepository(db);
    const [a, b] = await Promise.all([holding(bookings, request('a'), T0), holding(bookings, request('b'), T0)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((o) => !o.ok)).toMatchObject({ reason: 'unavailable' });
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM booking_holds').get()).toEqual({ n: 1 });
  });

  test('a state decided on stale data is not stored, not even in part', async () => {
    const db = memoryD1();
    const bookings = new BookingRepository(db);
    const stale = await bookings.load();
    const winner = hold(stale.state, request('a'), CONTEXT, T0);
    const loser = hold(stale.state, request('b'), CONTEXT, T0);
    expect(winner.ok && loser.ok).toBe(true);
    expect(await bookings.save(stale, winner.state)).toBe(true);
    expect(await bookings.save(stale, loser.state)).toBe(false);
    expect(await bookings.load()).toEqual({ state: winner.state, revision: 1 });
  });

  test('nothing to store is stored without a write, and expired holds are cleared with the next change', async () => {
    const db = memoryD1();
    const bookings = new BookingRepository(db);
    await holding(bookings, request('a'), T0);
    const loaded = await bookings.load();
    const before = db.queries();
    expect(await bookings.save(loaded, expire(loaded.state, T0 + 1))).toBe(true);
    expect(await bookings.save(loaded, { holds: [...loaded.state.holds], sessions: [] })).toBe(true);
    expect(db.queries()).toBe(before);

    const later = T0 + DEFAULT_SETTINGS.holdMinutes * 60_000;
    const again = await holding(bookings, request('b'), later);
    expect(again.ok).toBe(true);
    expect((await bookings.load()).state.holds.map((h) => h.id)).toEqual(['b']);
  });

  test('finished sessions can be left out of a load, and stay stored', async () => {
    const db = memoryD1();
    const bookings = new BookingRepository(db);
    await holding(bookings, request('a', MORNING, 'ben'), T0);
    const held = await bookings.load();
    await bookings.save(held, confirm(held.state, 'a', CONTEXT, T0).state);
    expect((await bookings.load(MORNING.end - 1)).state.sessions).toHaveLength(1);
    const later = await bookings.load(MORNING.end);
    expect(later.state.sessions).toEqual([]);
    expect(await bookings.save(later, { holds: [], sessions: [] })).toBe(true);
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM booking_sessions').get()).toEqual({ n: 1 });
  });

  test('a booking is linked to its order, once, and the link goes with the order', async () => {
    const db = memoryD1();
    const bookings = new BookingRepository(db);
    const orders = new OrderRepository(db);
    await orders.insert(anOrder('ord-1', 'recording', RECORDING));
    await orders.insert(anOrder('ord-2', 'recording', RECORDING));
    expect(await bookings.linkOrder('b', 'ord-1')).toBe(true);
    expect(await bookings.linkOrder('a', 'ord-1')).toBe(true);
    expect(await bookings.linkOrder('a', 'ord-2')).toBe(false);
    expect(await bookings.orderOf('a')).toBe('ord-1');
    expect(await bookings.orderOf('z')).toBeUndefined();
    expect(await bookings.bookingsOf('ord-1')).toEqual(['a', 'b']);
    db.sqlite.run("DELETE FROM orders WHERE id = 'ord-1'");
    expect(await bookings.bookingsOf('ord-1')).toEqual([]);
  });
});

describe('uploads', () => {
  const ref: FileRef = { orderId: 'ord-1', kind: 'sources', trackId: 'trk-1', fileId: 'f1' };
  const started = (over: Partial<FileRef> = {}, name = 'Take 1.wav'): UploadRecord =>
    initiate({ ...ref, ...over }, { name, size: 100 * MiB, type: 'audio/wav' }, 'upload-id', DEFAULT_FILE_SETTINGS, new Date(T0));

  async function withOrder(): Promise<{ uploads: UploadRepository; db: MemoryD1 }> {
    const db = memoryD1();
    await new OrderRepository(db).insert(anOrder('ord-1'));
    return { uploads: new UploadRepository(db), db };
  }

  test('a record comes back as it was saved, and its key and file id are taken once', async () => {
    const { uploads, db } = await withOrder();
    const record = started();
    expect(await uploads.insert(record)).toBe(true);
    expect(await uploads.get(record.key)).toEqual(record);
    expect(await uploads.get(record.key)).not.toHaveProperty('etag');
    expect(await uploads.insert({ ...record, uploadId: 'another' })).toBe(false);
    expect(await uploads.insert({ ...record, key: `${record.key}-2` })).toBe(false);
    expect((await uploads.get(record.key))?.uploadId).toBe('upload-id');
    expect(db.sqlite.query('SELECT created_at, size FROM uploads').get()).toEqual({ created_at: T0, size: 100 * MiB });
    await expect(uploads.insert(started({ orderId: 'ord-9' }))).rejects.toThrow(/FOREIGN KEY/);
  });

  test('an upload advances through its states, and completes once', async () => {
    const { uploads } = await withOrder();
    const record = started();
    await uploads.insert(record);
    const uploading = advance(record, { type: 'part-uploaded' }, new Date(T0 + 1000))!;
    expect(await uploads.advance(record, uploading)).toBe(true);
    const completed = advance(uploading, { type: 'completed', etag: '"abc-4"' }, new Date(T0 + 2000))!;
    const aborted = advance(uploading, { type: 'aborted' }, new Date(T0 + 2000))!;
    expect(await Promise.all([uploads.advance(uploading, completed), uploads.advance(uploading, aborted)])).toEqual([true, false]);
    expect(await uploads.get(record.key)).toEqual(completed);
  });

  test('an order’s uploads are listed for its byte count, stale ones found, and all forgotten together', async () => {
    const { uploads, db } = await withOrder();
    const a = started();
    const b = started({ fileId: 'f2', kind: 'results' }, 'Master.wav');
    const c = { ...started({ fileId: 'f3' }, 'Take 3.wav'), createdAt: new Date(T0 + 5000).toISOString(), updatedAt: new Date(T0 + 5000).toISOString() };
    for (const record of [a, b, c]) await uploads.insert(record);
    await uploads.advance(b, advance(b, { type: 'aborted' }, new Date(T0 + 1))!);

    const listed = await uploads.ofOrder('ord-1');
    expect(listed.map((r) => r.fileId)).toEqual(['f2', 'f1', 'f3']);
    expect(orderBytes(listed)).toBe(200 * MiB);
    expect((await uploads.stale(T0 + 5000)).map((r) => r.fileId)).toEqual(['f1']);

    expect(await uploads.delete(a.key)).toBe(true);
    expect(await uploads.delete(a.key)).toBe(false);
    expect(await uploads.deleteOfOrder('ord-1')).toBe(2);
    await uploads.insert(a);
    db.sqlite.run("DELETE FROM orders WHERE id = 'ord-1'");
    expect(await uploads.get(a.key)).toBeUndefined();
  });
});
