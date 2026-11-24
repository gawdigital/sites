import { describe, expect, test } from 'bun:test';

import { FakeProvider } from './fake.ts';
import { cancelPayment, isFinal, isMoney, isPaymentError, isPaymentStatus, PaymentError, type CreatePaymentRequest, type PaymentProvider } from './provider.ts';
import { applyPaymentEvent, newPaymentRecord } from './reconcile.ts';

const request: CreatePaymentRequest = {
  amount: { amount: 150000, currency: 'CZK' },
  reference: 'booking-42',
  label: 'Studio booking',
  customerEmail: 'name@example.com',
  customerName: 'Jane Doe',
  language: 'en',
  returnUrls: { paid: 'https://studio.example/paid', cancelled: 'https://studio.example/cancelled', pending: 'https://studio.example/pending' },
};

async function kind(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof PaymentError) return e.kind;
    throw e;
  }
  return 'none';
}

describe('the shared helpers', () => {
  test('money is a positive whole number of minor units in a currency', () => {
    expect(isMoney({ amount: 1, currency: 'CZK' })).toBe(true);
    for (const m of [{ amount: 0, currency: 'CZK' }, { amount: 1.5, currency: 'CZK' }, { amount: NaN, currency: 'CZK' }, { amount: 1, currency: 'Kč' }]) {
      expect(isMoney(m)).toBe(false);
    }
  });

  test('only paid and cancelled are final', () => {
    expect(['pending', 'authorised', 'paid', 'cancelled'].filter((s) => isPaymentStatus(s) && isFinal(s))).toEqual(['paid', 'cancelled']);
    expect(isPaymentStatus('refunded')).toBe(false);
  });

  test('an error is told by its kind', () => {
    const e = new PaymentError('rejected', 'no', { providerCode: 1400, httpStatus: 400 });
    expect(e).toBeInstanceOf(Error);
    expect(isPaymentError(e)).toBe(true);
    expect(isPaymentError(e, 'rejected')).toBe(true);
    expect(isPaymentError(e, 'transport')).toBe(false);
    expect(isPaymentError(new Error('no'))).toBe(false);
    expect([e.providerCode, e.httpStatus]).toEqual([1400, 400]);
  });

  test('a provider that cannot cancel says so', async () => {
    const fake = new FakeProvider();
    const { paymentId } = await fake.createPayment(request);
    const without: PaymentProvider = {
      name: 'plain',
      notificationAck: fake.notificationAck,
      createPayment: (r) => fake.createPayment(r),
      parseNotification: (i) => fake.parseNotification(i),
      getPayment: (id) => fake.getPayment(id),
      refund: (r) => fake.refund(r),
    };
    expect(await kind(cancelPayment(without, paymentId))).toBe('unsupported');
    await cancelPayment(fake, paymentId);
    expect((await fake.getPayment(paymentId)).status).toBe('cancelled');
  });
});

describe('the fake provider', () => {
  test('creates payments with predictable ids', async () => {
    const fake = new FakeProvider();
    expect(await fake.createPayment(request)).toEqual({ paymentId: 'fake-1', redirectUrl: 'https://pay.example/fake-1' });
    expect(await fake.createPayment({ ...request, reference: 'booking-43' })).toEqual({ paymentId: 'fake-2', redirectUrl: 'https://pay.example/fake-2' });
    expect(await fake.getPayment('fake-2')).toEqual({
      provider: 'fake',
      paymentId: 'fake-2',
      reference: 'booking-43',
      status: 'pending',
      amount: { amount: 150000, currency: 'CZK' },
      test: false,
      refunded: 0,
    });
    expect(await kind(fake.createPayment({ ...request, amount: { amount: 0.5, currency: 'CZK' } }))).toBe('invalid_request');
  });

  test('moves only the way a gateway does', async () => {
    const fake = new FakeProvider();
    const { paymentId } = await fake.createPayment(request);
    fake.settle(paymentId, 'authorised');
    fake.settle(paymentId, 'paid');
    fake.settle(paymentId, 'paid');
    expect(() => fake.settle(paymentId, 'cancelled')).toThrow();
    expect(() => fake.settle('fake-9', 'paid')).toThrow();
  });

  test('notifies with a secret, and refuses a forged or unreadable notification', async () => {
    const fake = new FakeProvider({ test: true });
    const { paymentId } = await fake.createPayment(request);
    fake.settle(paymentId, 'paid');
    expect(await fake.parseNotification(fake.notification(paymentId))).toMatchObject({ paymentId, status: 'paid', test: true });
    expect(await kind(fake.parseNotification(fake.notification(paymentId, { secret: 'guess' })))).toBe('unauthenticated');
    expect(await kind(fake.parseNotification({ contentType: null, body: 'status=PAID' }))).toBe('malformed');
    expect(await kind(fake.parseNotification({ contentType: null, body: 'null' }))).toBe('malformed');
  });

  test('refunds in full or in parts, up to what was paid', async () => {
    const fake = new FakeProvider();
    const { paymentId } = await fake.createPayment(request);
    expect(await kind(fake.refund({ paymentId, amount: request.amount }))).toBe('rejected');
    fake.settle(paymentId, 'paid');
    await fake.refund({ paymentId, amount: { amount: 50000, currency: 'CZK' } });
    expect(await kind(fake.refund({ paymentId, amount: { amount: 100001, currency: 'CZK' } }))).toBe('rejected');
    expect(await kind(fake.refund({ paymentId, amount: { amount: 1, currency: 'EUR' } }))).toBe('rejected');
    expect(await kind(fake.refund({ paymentId, amount: { amount: 0, currency: 'CZK' } }))).toBe('invalid_request');
    await fake.refund({ paymentId, amount: { amount: 100000, currency: 'CZK' }, reference: 'refund-2' });
    expect(fake.payments.get(paymentId)!.refunded).toBe(150000);
    expect(fake.refunds.map((r) => r.amount.amount)).toEqual([50000, 100000]);
    expect(await kind(fake.refund({ paymentId: 'fake-9', amount: request.amount }))).toBe('rejected');
  });

  test('cancels only what is still pending', async () => {
    const fake = new FakeProvider();
    const { paymentId } = await fake.createPayment(request);
    await fake.cancel(paymentId);
    expect(await kind(fake.cancel(paymentId))).toBe('rejected');
  });

  test('fails on demand, once', async () => {
    const fake = new FakeProvider();
    fake.failNext();
    expect(await kind(fake.createPayment(request))).toBe('transport');
    fake.failNext(new PaymentError('rejected', 'no', { providerCode: 1 }));
    expect(await kind(fake.getPayment('fake-1'))).toBe('rejected');
    expect((await fake.createPayment(request)).paymentId).toBe('fake-1');
  });

  test('drives a booking’s payment from hold to confirmation, exactly once', async () => {
    const fake = new FakeProvider();
    const { paymentId } = await fake.createPayment(request);
    let record = newPaymentRecord(fake.name, paymentId, request.reference, request.amount, 1);
    fake.settle(paymentId, 'paid');

    const effects = [];
    for (let i = 0; i < 3; i++) {
      const transition = applyPaymentEvent(record, await fake.parseNotification(fake.notification(paymentId)), 2 + i);
      record = transition.record;
      effects.push(transition.effect);
    }
    expect(effects).toEqual(['confirm', 'none', 'none']);
    expect(record).toMatchObject({ status: 'paid', updatedAt: 2 });
  });

  test('says how a payment was made and how much of it went back', async () => {
    const fake = new FakeProvider();
    const { paymentId } = await fake.createPayment(request);
    expect((await fake.getPayment(paymentId)).method).toBeUndefined();
    fake.settle(paymentId, 'paid', 'BANK_CZ_RB');
    expect(await fake.getPayment(paymentId)).toMatchObject({ status: 'paid', method: 'BANK_CZ_RB', refunded: 0 });
    await fake.refund({ paymentId, amount: request.amount, reference: 'r-1' });
    expect((await fake.parseNotification(fake.notification(paymentId))).refunded).toBe(request.amount.amount);
  });

  test('keeps to a gateway’s bounds on the expiry when it is given them', async () => {
    expect(new FakeProvider().expiryMinutes).toBeUndefined();
    expect((await new FakeProvider().createPayment({ ...request, expiresInMinutes: 10 })).paymentId).toBe('fake-1');

    const bounded = new FakeProvider({ expiryMinutes: { min: 30, max: 10_080 } });
    expect(bounded.expiryMinutes).toEqual({ min: 30, max: 10_080 });
    expect(await kind(bounded.createPayment({ ...request, expiresInMinutes: 10 }))).toBe('invalid_request');
    expect(await kind(bounded.createPayment({ ...request, expiresInMinutes: 10_081 }))).toBe('invalid_request');
    expect((await bounded.createPayment({ ...request, expiresInMinutes: 30 })).paymentId).toBe('fake-1');
    expect((await bounded.createPayment(request)).paymentId).toBe('fake-2');
  });
});
