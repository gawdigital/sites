import { describe, expect, test } from 'bun:test';

import { PAYMENT_STATUSES, type PaymentEvent, type PaymentStatus } from './provider.ts';
import { applyPaymentEvent, newPaymentRecord, type PaymentEffect, type PaymentRecord } from './reconcile.ts';

const CREATED = 1_000;
const NOW = 2_000;

const record = (status: PaymentStatus = 'pending'): PaymentRecord => ({
  ...newPaymentRecord('comgate', 'AB12-CD34-EF56', 'booking-42', { amount: 150000, currency: 'CZK' }, CREATED),
  status,
});

const event = (status: PaymentStatus, over: Partial<PaymentEvent> = {}): PaymentEvent => ({
  provider: 'comgate',
  paymentId: 'AB12-CD34-EF56',
  reference: 'booking-42',
  status,
  amount: { amount: 150000, currency: 'CZK' },
  test: false,
  ...over,
});

describe('a new record', () => {
  test('is pending and keeps its own copy of the amount', () => {
    const amount = { amount: 100, currency: 'EUR' };
    const r = newPaymentRecord('fake', 'p', 'ref', amount, CREATED);
    expect(r).toEqual({ provider: 'fake', paymentId: 'p', reference: 'ref', amount, status: 'pending', updatedAt: CREATED });
    expect(r.amount).not.toBe(amount);
  });
});

describe('an event moves a payment forward', () => {
  test('paid confirms, once', () => {
    const first = applyPaymentEvent(record(), event('paid'), NOW);
    expect(first).toEqual({ record: { ...record(), status: 'paid', updatedAt: NOW }, effect: 'confirm', outcome: 'applied' });

    const again = applyPaymentEvent(first.record, event('paid'), NOW + 1);
    expect(again).toEqual({ record: first.record, effect: 'none', outcome: 'duplicate' });
    expect(again.record).toBe(first.record);
  });

  test('cancelled releases, once', () => {
    const first = applyPaymentEvent(record(), event('cancelled'), NOW);
    expect(first).toMatchObject({ record: { status: 'cancelled', updatedAt: NOW }, effect: 'release', outcome: 'applied' });
    expect(applyPaymentEvent(first.record, event('cancelled'), NOW + 1)).toMatchObject({ effect: 'none', outcome: 'duplicate' });
  });

  test('authorised is recorded and does nothing yet; it may still be paid or cancelled', () => {
    const held = applyPaymentEvent(record(), event('authorised'), NOW);
    expect(held).toMatchObject({ record: { status: 'authorised' }, effect: 'none', outcome: 'applied' });
    expect(applyPaymentEvent(held.record, event('paid'), NOW)).toMatchObject({ effect: 'confirm', outcome: 'applied' });
    expect(applyPaymentEvent(held.record, event('cancelled'), NOW)).toMatchObject({ effect: 'release', outcome: 'applied' });
  });

  test('the input record is never changed', () => {
    const before = Object.freeze(record());
    applyPaymentEvent(before, event('paid'), NOW);
    expect(before.status).toBe('pending');
  });
});

describe('an event out of order', () => {
  test('an older state after a newer one is stale', () => {
    for (const [stored, late] of [
      ['authorised', 'pending'],
      ['paid', 'pending'],
      ['paid', 'authorised'],
      ['cancelled', 'pending'],
      ['cancelled', 'authorised'],
    ] as const) {
      const r = record(stored);
      expect(applyPaymentEvent(r, event(late), NOW)).toEqual({ record: r, effect: 'none', outcome: 'stale' });
    }
  });

  test('paid after cancelled changes nothing and is flagged', () => {
    const r = record('cancelled');
    expect(applyPaymentEvent(r, event('paid'), NOW)).toEqual({ record: r, effect: 'none', outcome: 'conflict' });
  });

  test('cancelled after paid changes nothing and is flagged', () => {
    const r = record('paid');
    expect(applyPaymentEvent(r, event('cancelled'), NOW)).toEqual({ record: r, effect: 'none', outcome: 'conflict' });
  });
});

describe('an event about something else', () => {
  test('is rejected, whatever it claims', () => {
    const r = record();
    const cases: Array<[Partial<PaymentEvent>, string]> = [
      [{ provider: 'fake' }, 'provider_mismatch'],
      [{ paymentId: 'ZZZZ-ZZZZ-ZZZZ' }, 'payment_mismatch'],
      [{ reference: 'booking-43' }, 'reference_mismatch'],
      [{ amount: { amount: 150000, currency: 'EUR' } }, 'currency_mismatch'],
      [{ amount: { amount: 100, currency: 'CZK' } }, 'amount_mismatch'],
      [{ amount: { amount: 150001, currency: 'CZK' } }, 'amount_mismatch'],
      [{ test: true }, 'test_mismatch'],
    ];
    for (const [over, outcome] of cases) {
      expect(applyPaymentEvent(r, event('paid', over), NOW)).toEqual({ record: r, effect: 'none', outcome: outcome as never });
    }
  });

  test('a mismatch wins over a duplicate', () => {
    const r = record('paid');
    expect(applyPaymentEvent(r, event('paid', { amount: { amount: 1, currency: 'CZK' } }), NOW).outcome).toBe('amount_mismatch');
  });

  test('a test payment counts where tests are accepted', () => {
    expect(applyPaymentEvent(record(), event('paid', { test: true }), NOW, { acceptTest: true })).toMatchObject({ effect: 'confirm', outcome: 'applied' });
  });
});

describe('whatever arrives, in whatever order', () => {
  test('a payment is confirmed or released at most once, never both', () => {
    const statuses = [...PAYMENT_STATUSES];
    // Every sequence of four events over the four states.
    for (let n = 0; n < statuses.length ** 4; n++) {
      const sequence = [0, 1, 2, 3].map((i) => statuses[Math.floor(n / statuses.length ** i) % statuses.length]!);
      let r = record();
      const effects: PaymentEffect[] = [];
      for (const s of sequence) {
        const t = applyPaymentEvent(r, event(s), NOW);
        r = t.record;
        if (t.effect !== 'none') effects.push(t.effect);
      }
      const firstFinal = sequence.find((s) => s === 'paid' || s === 'cancelled');
      expect(effects).toEqual(firstFinal === 'paid' ? ['confirm'] : firstFinal === 'cancelled' ? ['release'] : []);
      if (firstFinal) expect(r.status).toBe(firstFinal);
    }
  });
});
