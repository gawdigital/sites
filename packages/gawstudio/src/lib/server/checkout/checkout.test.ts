import { describe, expect, test } from 'bun:test';

import { redeem } from '../auth/index.ts';
import { PaymentError } from '../payments/index.ts';
import { handlePaymentNotification } from './notify.ts';
import { startCheckout } from './start.ts';
import { sweep } from './sweep.ts';
import { CUSTOMER, HOUR, MINUTE, MORNING, names, NOW, recordingCart, slot, STORES, studio, tracksCart } from './testing.ts';
import type { Studio } from './testing.ts';
import type { Effect, Email, NotificationResult, StartResult } from './types.ts';

const CONFIRMED = ['order-confirmed', 'studio-new-order', 'order-paid'];

function started(result: StartResult): Extract<StartResult, { ok: true }> {
  if (!result.ok) throw new Error(`the checkout did not start: ${JSON.stringify(result)}`);
  return result;
}

function handled(result: NotificationResult): Extract<NotificationResult, { ok: true }> {
  if (!result.ok) throw new Error(`the notification was refused: ${result.error}`);
  return result;
}

function email<T extends Email['template']>(effects: readonly Effect[], template: T): Extract<Email, { template: T }> {
  const found = effects.find((effect): effect is Extract<Email, { template: T }> => effect.type === 'email' && effect.template === template);
  if (!found) throw new Error(`no ${template} e-mail among ${names(effects).join(', ')}`);
  return found;
}

const checkoutOf = (s: Studio, orderId: string) => s.checkout(orderId);

/** A recording order started, with the hold run out and nothing swept. */
async function expiredHold(s: Studio, orderId: string): Promise<void> {
  started(await startCheckout(s.deps, recordingCart(orderId)));
  s.clock.now += 11 * MINUTE;
}

// The same behaviour on both stores: what holds in memory must hold on D1.
for (const kind of STORES) {
  describe(`the checkout on the ${kind} store`, () => {
    describe('starting a checkout', () => {
      test('a recording session is priced from the offered slot, held, and sent to its payment', async () => {
        const s = studio({}, kind);
        const result = started(await startCheckout(s.deps, recordingCart('order-rec-1')));

        expect(result).toEqual({ ok: true, orderId: 'order-rec-1', redirectUrl: 'https://pay.example/fake-1', resumed: false, effects: [] });
        expect((await s.booking()).holds).toEqual([{ id: 'order-rec-1', start: MORNING.start, end: MORNING.end, technicianId: null, createdAt: NOW, expiresAt: NOW + 10 * MINUTE }]);
        const checkout = await checkoutOf(s, 'order-rec-1');
        expect(checkout.order).toMatchObject({ flow: 'recording', state: 'awaiting-payment' });
        expect(checkout.slot).toEqual({ ...MORNING, kind: 'block', holdExpiresAt: NOW + 10 * MINUTE });
        // A 4 h block, 3,200 Kč net, with 21 % VAT.
        expect(checkout.quote.total).toBe(387_200);
        expect(s.payments.payments.get('fake-1')?.request).toMatchObject({
          amount: { amount: 387_200, currency: 'CZK' },
          reference: 'order-rec-1',
          label: 'G.A.W.Studio',
          customerEmail: 'name@example.com',
          language: 'en',
        });
        expect(checkout.payment).toMatchObject({ provider: 'fake', paymentId: 'fake-1', status: 'pending' });
      });

      test('the whole day and its price come from the booking, not from the form', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, recordingCart('order-day-1', slot('09:00', '18:00', 'nero'))));
        const checkout = await checkoutOf(s, 'order-day-1');
        expect(checkout.slot?.kind).toBe('wholeDay');
        expect(checkout.quote.lines.map((line) => line.code)).toEqual(['day']);
        expect(checkout.quote.total).toBe(774_400);
      });

      test('tracks need no hold; mix is a classic order and AI-assisted work an AI order', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, tracksCart('order-mix-1')));
        started(await startCheckout(s.deps, tracksCart('order-ai-01', 'ai-mix', 1)));

        expect((await s.booking()).holds).toEqual([]);
        expect((await checkoutOf(s, 'order-mix-1')).order).toMatchObject({ flow: 'classic', state: 'awaiting-payment' });
        expect((await checkoutOf(s, 'order-mix-1')).quote.total).toBe(48_400);
        expect((await checkoutOf(s, 'order-ai-01')).order.flow).toBe('ai');
      });

      test('a request is refused with every problem it has', async () => {
        const s = studio({}, kind);
        const bad = await startCheckout(s.deps, { orderId: 'x', customer: { email: 'nobody', name: ' ', language: 'fr' as 'en' }, currency: 'CZK' });
        expect(bad).toEqual({
          ok: false,
          error: 'invalid',
          problems: [
            { code: 'invalid-order-id', path: 'orderId' },
            { code: 'invalid-email', path: 'customer.email' },
            { code: 'invalid-name', path: 'customer.name' },
            { code: 'invalid-language', path: 'customer.language' },
            { code: 'empty', path: '' },
          ],
        });
        expect((await s.count())).toBe(0);
      });

      test('a cart of mixed kinds, an unknown service and a company without a name are refused', async () => {
        const s = studio({}, kind);
        const mixed = await startCheckout(s.deps, { ...recordingCart('order-bad-1'), tracks: [{ service: 'mix', technician: 'libor', tracks: 1 }] });
        expect(mixed).toMatchObject({ ok: false, error: 'invalid', problems: [{ code: 'mixed-cart', path: '' }] });

        const both = await startCheckout(s.deps, {
          ...tracksCart('order-bad-2'),
          tracks: [
            { service: 'mix', technician: 'libor', tracks: 1 },
            { service: 'ai-mix', technician: 'libor', tracks: 1 },
          ],
        });
        expect(both).toMatchObject({ ok: false, error: 'invalid', problems: [{ code: 'mixed-cart', path: 'tracks' }] });

        const unknown = await startCheckout(s.deps, tracksCart('order-bad-3', 'remix'));
        expect(unknown).toMatchObject({ ok: false, error: 'invalid', problems: [{ code: 'unknown-service', path: 'tracks[0]' }] });

        const company = await startCheckout(s.deps, { ...tracksCart('order-bad-4'), company: { vatId: 'CZ00000000' } });
        expect(company).toMatchObject({ ok: false, error: 'invalid', problems: [{ code: 'company-name-missing', path: 'company.name' }] });

        expect((await s.count())).toBe(0);
        expect(s.payments.payments.size).toBe(0);
      });

      test('a slot that is held, or is no slot at all, cannot be checked out', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, recordingCart('order-rec-1')));

        expect(await startCheckout(s.deps, recordingCart('order-rec-2'))).toEqual({ ok: false, error: 'unavailable', reason: 'unavailable' });
        expect(await startCheckout(s.deps, recordingCart('order-rec-3', slot('10:00', '12:00')))).toEqual({ ok: false, error: 'unavailable', reason: 'unavailable' });
        expect(await startCheckout(s.deps, recordingCart('order-rec-4', slot('14:00', '18:00', 'nobody')))).toEqual({ ok: false, error: 'unavailable', reason: 'unknown-technician' });
        expect((await s.count())).toBe(1);
        expect(s.payments.payments.size).toBe(1);
      });

      test('the same form sent again returns the same payment page; another cart under its id is refused', async () => {
        const s = studio({}, kind);
        const first = started(await startCheckout(s.deps, recordingCart('order-rec-1')));
        s.clock.now += MINUTE;
        const second = started(await startCheckout(s.deps, recordingCart('order-rec-1')));

        expect(second).toEqual({ ...first, resumed: true });
        expect(s.payments.payments.size).toBe(1);
        expect((await s.booking()).holds).toHaveLength(1);
        expect(await startCheckout(s.deps, recordingCart('order-rec-1', slot('14:00', '18:00')))).toEqual({ ok: false, error: 'order-exists' });
      });

      test('a provider that fails leaves the order to be tried again, with its slot', async () => {
        const s = studio({}, kind);
        s.payments.failNext();
        expect(await startCheckout(s.deps, recordingCart('order-rec-1'))).toEqual({ ok: false, error: 'payment-unavailable', retryable: true });
        expect((await checkoutOf(s, 'order-rec-1')).payment).toBeUndefined();

        s.clock.now += MINUTE;
        const again = started(await startCheckout(s.deps, recordingCart('order-rec-1')));
        expect(again.resumed).toBe(false);
        expect(s.payments.payments.size).toBe(1);
        // The hold is the first one: its time was not extended.
        expect((await s.booking()).holds).toHaveLength(1);
        expect((await checkoutOf(s, 'order-rec-1')).slot?.holdExpiresAt).toBe(NOW + 10 * MINUTE);
      });

      test('an order that is paid is not sent to pay again', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, tracksCart('order-mix-1')));
        await s.settle('order-mix-1', 'paid');
        expect(await startCheckout(s.deps, tracksCart('order-mix-1'))).toEqual({ ok: false, error: 'not-awaiting-payment', state: 'awaiting-files' });
      });
    });

    describe('a paid notification', () => {
      test('recording: the session, the order, the account, the paid invoice and the magic link', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, recordingCart('order-rec-1')));
        s.clock.now += 3 * MINUTE;
        const result = handled(await s.settle('order-rec-1', 'paid'));

        expect(result).toMatchObject({ acknowledge: { status: 200, body: 'OK' }, orderId: 'order-rec-1', outcome: 'applied', state: 'paid', unfinished: false });
        expect(names(result.effects)).toEqual(CONFIRMED);

        const session = { id: 'order-rec-1', start: MORNING.start, end: MORNING.end, technicianId: 'libor', confirmedAt: s.clock.now };
        expect((await s.booking())).toEqual({ holds: [], sessions: [session] });
        const checkout = await checkoutOf(s, 'order-rec-1');
        expect(checkout.session).toEqual(session);
        expect(checkout.settlement).toMatchObject({ booking: 'confirmed', invoicePaid: true, invoiceEmailed: true, confirmed: true, done: true });

        const account = [...s.auth.accounts.values()];
        expect(account).toMatchObject([{ email: 'name@example.com', emailVerifiedAt: null }]);

        expect(s.invoicing.issued).toHaveLength(1);
        const [issued] = s.invoicing.issued;
        expect(issued?.document).toMatchObject({ reference: 'order-rec-1', paid: true, total: { amount: 387_200, currency: 'CZK' } });
        expect(issued?.input).toMatchObject({ priceMode: 'net', language: 'en', tag: 'gawstudio', lines: [{ name: `Recording, 4 h block (2026-06-01)`, quantity: 1, unitPrice: 320_000, vatRate: 21 }] });
        expect(issued?.payments).toEqual([{ paidOn: '2026-05-20', amount: { amount: 387_200, currency: 'CZK' } }]);
        expect(issued?.emails).toBe(1);
        expect([...s.invoicing.customers.keys()]).toEqual([`account:${account[0]?.id}`]);

        const confirmation = email(result.effects, 'order-confirmed');
        expect(confirmation.to).toEqual({ kind: 'customer', ...CUSTOMER });
        expect(confirmation.data).toMatchObject({ orderId: 'order-rec-1', flow: 'recording', total: { amount: 387_200, currency: 'CZK' }, session, invoiceUrl: issued?.document.publicUrl });
        // The link in the e-mail signs the customer in to this order, and proves the address.
        expect(await redeem(s.auth, confirmation.data.link.token, s.clock.now)).toMatchObject({ ok: true, created: false, purpose: { kind: 'order', orderId: 'order-rec-1' } });
        expect(email(result.effects, 'studio-new-order').to).toEqual({ kind: 'studio' });
        expect(result.effects.at(-1)).toEqual({ type: 'order-paid', id: 'order-rec-1:order-paid', orderId: 'order-rec-1', flow: 'recording', session });
      });

      test('mix: the order waits for its files, and the invoice in euros carries the exchange rate and the company', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, { ...tracksCart('order-mix-1'), company: { name: 'Example Ltd', companyId: '12345678' } }));
        const result = handled(await s.settle('order-mix-1', 'paid'));

        expect(result).toMatchObject({ outcome: 'applied', state: 'awaiting-files', unfinished: false });
        expect(names(result.effects)).toEqual(CONFIRMED);
        expect((await checkoutOf(s, 'order-mix-1')).settlement).toMatchObject({ booking: 'none', done: true });
        const [issued] = s.invoicing.issued;
        expect(issued?.document).toMatchObject({ paid: true, total: { amount: 48_400, currency: 'EUR' } });
        expect(issued?.input).toMatchObject({ currency: 'EUR', exchangeRate: '25.215', lines: [{ name: 'Mix — Libor', quantity: 2, unit: 'track', unitPrice: 20_000, vatRate: 21 }] });
        const [customer] = [...s.invoicing.customers.values()];
        expect(customer?.customer).toMatchObject({ name: 'Jane Doe', email: 'name@example.com', company: { name: 'Example Ltd', companyId: '12345678' } });
        expect(customer?.customer.reference).toEndWith(':company:12345678');
      });

      test('mastering with the quantity discount: the invoice has the discount line and the paid total', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, tracksCart('order-mas-1', 'mastering', 5)));
        const result = handled(await s.settle('order-mas-1', 'paid'));

        // 5 × 100 € less 5 %, plus 21 % VAT.
        expect(names(result.effects)).toEqual(CONFIRMED);
        expect(s.invoicing.issued[0]?.document).toMatchObject({ paid: true, total: { amount: 57_475, currency: 'EUR' } });
        expect(s.invoicing.issued[0]?.input.lines.map((line) => line.unitPrice)).toEqual([10_000, -2_500]);
      });

      test('AI-assisted: the order stays paid, and the effect says a draft is due', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, tracksCart('order-ai-01', 'ai-mix', 1)));
        const result = handled(await s.settle('order-ai-01', 'paid'));

        expect(result).toMatchObject({ outcome: 'applied', state: 'paid', unfinished: false });
        expect(result.effects.at(-1)).toEqual({ type: 'order-paid', id: 'order-ai-01:order-paid', orderId: 'order-ai-01', flow: 'ai' });
        expect(s.invoicing.issued[0]?.document).toMatchObject({ paid: true, total: { amount: 6_050, currency: 'EUR' } });
      });

      test('a returning customer keeps the one account', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, tracksCart('order-mix-1')));
        started(await startCheckout(s.deps, { ...tracksCart('order-mix-2'), customer: { ...CUSTOMER, email: ' Name@Example.com ' } }));
        await s.settle('order-mix-1', 'paid');
        await s.settle('order-mix-2', 'paid');

        expect(s.auth.accounts.size).toBe(1);
        expect(s.invoicing.customers.size).toBe(1);
        expect(s.invoicing.issued).toHaveLength(2);
      });

      test('delivered again, it changes nothing and asks for nothing', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, recordingCart('order-rec-1')));
        handled(await s.settle('order-rec-1', 'paid'));
        const before = await checkoutOf(s, 'order-rec-1');
        const calls = s.invoicing.calls.length;

        for (const later of [MINUTE, HOUR]) {
          s.clock.now += later;
          const again = handled(await s.notify('order-rec-1'));
          expect(again).toMatchObject({ outcome: 'duplicate', state: 'paid', unfinished: false, effects: [] });
        }
        expect((await checkoutOf(s, 'order-rec-1'))).toEqual(before);
        expect((await s.booking()).sessions).toHaveLength(1);
        expect(s.invoicing.issued).toHaveLength(1);
        expect(s.invoicing.issued[0]?.payments).toHaveLength(1);
        expect(s.invoicing.calls).toHaveLength(calls);
        expect(s.auth.links.size).toBe(1);
        expect(s.payments.refunds).toEqual([]);
      });

      test('delivered twice at once, one delivery acts and the other is told to come back', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, recordingCart('order-rec-1')));
        s.payments.settle('fake-1', 'paid');
        const results = await Promise.all([s.notify('order-rec-1'), s.notify('order-rec-1')]);

        expect(results.map((result) => (result.ok ? 'ok' : result.error)).sort()).toEqual(['busy', 'ok']);
        expect(results.flatMap((result) => names(result.effects))).toEqual(CONFIRMED);
        expect((await s.booking()).sessions).toHaveLength(1);
        expect(s.invoicing.issued).toHaveLength(1);
        expect(s.invoicing.issued[0]?.payments).toHaveLength(1);
        expect(s.auth.links.size).toBe(1);
        // The delivery that was turned away comes again and finds nothing left to do.
        expect(handled(await s.notify('order-rec-1'))).toMatchObject({ outcome: 'duplicate', unfinished: false, effects: [] });
      });

      test('a pending notification is acknowledged and changes nothing', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, recordingCart('order-rec-1')));
        const result = handled(await s.notify('order-rec-1'));
        expect(result).toMatchObject({ outcome: 'duplicate', state: 'awaiting-payment', unfinished: false, effects: [] });
        expect((await s.booking()).holds).toHaveLength(1);
      });
    });

    describe('a notification that is not to be trusted', () => {
      test('a forged or unreadable one is refused without an acknowledgement', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, recordingCart('order-rec-1')));
        s.payments.settle('fake-1', 'paid');

        expect(await handlePaymentNotification(s.deps, s.payments.notification('fake-1', { secret: 'guessed' }))).toEqual({ ok: false, error: 'unauthenticated', status: 401, effects: [] });
        expect(await handlePaymentNotification(s.deps, { contentType: 'text/plain', body: 'paid!' })).toEqual({ ok: false, error: 'malformed', status: 400, effects: [] });
        expect((await checkoutOf(s, 'order-rec-1')).order.state).toBe('awaiting-payment');
      });

      test('a payment for a reference no order has is acknowledged and reported', async () => {
        const s = studio({}, kind);
        const { paymentId } = await s.payments.createPayment({
          amount: { amount: 1000, currency: 'CZK' },
          reference: 'not-an-order',
          label: 'Other',
          customerEmail: 'name@example.com',
          customerName: 'Jane Doe',
          language: 'en',
          returnUrls: s.deps.returnUrls('not-an-order', 'en'),
        });
        s.payments.settle(paymentId, 'paid');
        const result = handled(await handlePaymentNotification(s.deps, s.payments.notification(paymentId)));

        expect(result).toMatchObject({ outcome: 'unknown-order', unfinished: false });
        expect(names(result.effects)).toEqual(['studio-alert:unknown-order']);
        expect(s.invoicing.calls).toEqual([]);
      });

      test('a test payment does not count where test payments are not accepted, and is reported once', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, recordingCart('order-rec-1')));
        // The gateway's record of the same payment, marked as a test one.
        const event = { provider: 'fake', paymentId: 'fake-1', reference: 'order-rec-1', status: 'paid', amount: { amount: 387_200, currency: 'CZK' }, test: true } as const;
        s.deps.payments = Object.assign(Object.create(s.payments), { parseNotification: async () => event });

        const first = handled(await s.notify('order-rec-1'));
        expect(first).toMatchObject({ outcome: 'test_mismatch', state: 'awaiting-payment' });
        expect(names(first.effects)).toEqual(['studio-alert:payment-mismatch']);
        expect(handled(await s.notify('order-rec-1')).effects).toEqual([]);
        expect((await s.booking()).sessions).toEqual([]);
        expect(s.invoicing.calls).toEqual([]);
      });
    });

    describe('a failed or cancelled payment', () => {
      test('the hold is released, the order cancelled and the customer told, once', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, recordingCart('order-rec-1')));
        s.clock.now += 2 * MINUTE;
        const result = handled(await s.settle('order-rec-1', 'cancelled'));

        expect(result).toMatchObject({ outcome: 'applied', state: 'cancelled', unfinished: false });
        expect(names(result.effects)).toEqual(['payment-not-completed']);
        expect(email(result.effects, 'payment-not-completed').data).toEqual({ orderId: 'order-rec-1', reason: 'cancelled', slot: { start: MORNING.start, end: MORNING.end } });
        expect((await s.booking())).toEqual({ holds: [], sessions: [] });
        expect(s.invoicing.calls).toEqual([]);
        expect(s.auth.accounts.size).toBe(0);

        expect(handled(await s.notify('order-rec-1'))).toMatchObject({ outcome: 'duplicate', state: 'cancelled', effects: [] });
        // The slot is on offer again at once.
        expect(started(await startCheckout(s.deps, recordingCart('order-rec-2'))).resumed).toBe(false);
      });

      test('a cancelled payment for tracks cancels the order', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, tracksCart('order-mix-1')));
        const result = handled(await s.settle('order-mix-1', 'cancelled'));
        expect(result).toMatchObject({ outcome: 'applied', state: 'cancelled' });
        expect(email(result.effects, 'payment-not-completed').data).toEqual({ orderId: 'order-mix-1', reason: 'cancelled' });
      });
    });

    describe('a payment that arrives after the hold ran out', () => {
      test('is accepted when the slot is still free', async () => {
        const s = studio({}, kind);
        await expiredHold(s, 'order-rec-1');
        const result = handled(await s.settle('order-rec-1', 'paid'));

        expect(result).toMatchObject({ outcome: 'applied', state: 'paid', unfinished: false });
        expect(names(result.effects)).toEqual(CONFIRMED);
        expect((await checkoutOf(s, 'order-rec-1')).settlement?.booking).toBe('rebooked');
        expect((await s.booking())).toMatchObject({ holds: [], sessions: [{ id: 'order-rec-1', technicianId: 'libor' }] });
        expect(s.invoicing.issued[0]?.document.paid).toBe(true);
        expect(s.payments.refunds).toEqual([]);
      });

      test('is accepted inside the lead time too: the customer met it when choosing the slot', async () => {
        const s = studio({}, kind);
        s.clock.now = MORNING.start - 24 * HOUR - 5 * MINUTE;
        await expiredHold(s, 'order-rec-1');
        // Nobody else could book the slot now; the customer who paid for it still gets it.
        expect(await startCheckout(s.deps, recordingCart('order-rec-2'))).toMatchObject({ ok: false, error: 'unavailable' });
        expect(handled(await s.settle('order-rec-1', 'paid'))).toMatchObject({ state: 'paid', unfinished: false });
        expect((await s.booking()).sessions).toHaveLength(1);
      });

      test('is refunded when someone else holds the slot by then, and no invoice is issued', async () => {
        const s = studio({}, kind);
        await expiredHold(s, 'order-rec-1');
        started(await startCheckout(s.deps, recordingCart('order-rec-2')));
        const result = handled(await s.settle('order-rec-1', 'paid'));

        expect(result).toMatchObject({ outcome: 'applied', state: 'refunded', unfinished: false });
        expect(names(result.effects)).toEqual(['slot-lost', 'studio-alert:slot-lost']);
        expect(email(result.effects, 'slot-lost').data).toEqual({ orderId: 'order-rec-1', slot: { start: MORNING.start, end: MORNING.end }, amount: { amount: 387_200, currency: 'CZK' } });
        expect(s.payments.refunds).toEqual([{ paymentId: 'fake-1', amount: { amount: 387_200, currency: 'CZK' }, reference: 'order-rec-1-refund' }]);
        expect((await checkoutOf(s, 'order-rec-1'))).toMatchObject({ settlement: { booking: 'lost', done: true }, refund: { reason: 'slot-lost', detail: 'unavailable', state: 'done', attempts: 1 } });
        // Straight from waiting to refunded: the order was never `paid`, and the payment's record says what went back.
        const refunded = await checkoutOf(s, 'order-rec-1');
        expect(refunded.order.history.map((entry) => entry.state)).toEqual(['draft', 'awaiting-payment', 'refunded']);
        expect(refunded.payment).toMatchObject({ status: 'paid', method: 'CARD', refunded: 387_200 });
        expect(s.invoicing.calls).toEqual([]);
        expect(s.auth.accounts.size).toBe(0);
        // The other customer's hold is untouched, and can still be paid.
        expect((await s.booking()).holds.map((held) => held.id)).toEqual(['order-rec-2']);

        expect(handled(await s.notify('order-rec-1'))).toMatchObject({ outcome: 'duplicate', state: 'refunded', effects: [] });
        expect(s.payments.refunds).toHaveLength(1);
        expect(handled(await s.settle('order-rec-2', 'paid'))).toMatchObject({ state: 'paid', unfinished: false });
      });

      test('is refunded when a rehearsal has taken the slot, even while the hold runs', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, recordingCart('order-rec-1')));
        s.calendar.push({ start: MORNING.start + HOUR, end: MORNING.end, kind: 'calendar' });
        const result = handled(await s.settle('order-rec-1', 'paid'));

        expect(result).toMatchObject({ state: 'refunded' });
        expect(names(result.effects)).toEqual(['slot-lost', 'studio-alert:slot-lost']);
        expect(s.payments.refunds).toHaveLength(1);
        expect((await s.booking())).toEqual({ holds: [], sessions: [] });
      });

      test('a refund the provider cannot take just now is made by the sweep, once', async () => {
        const s = studio({}, kind);
        await expiredHold(s, 'order-rec-1');
        started(await startCheckout(s.deps, recordingCart('order-rec-2')));
        s.payments.settle('fake-1', 'paid');
        s.payments.failNext();
        const result = handled(await s.notify('order-rec-1'));

        // Never `paid` in the lifecycle: the order waits where it is, and goes straight to `refunded`.
        expect(result).toMatchObject({ state: 'awaiting-payment', unfinished: true });
        expect(names(result.effects)).toEqual(['slot-lost', 'studio-alert:slot-lost']);
        expect((await checkoutOf(s, 'order-rec-1')).refund).toMatchObject({ state: 'pending', attempts: 1 });

        const swept = await sweep(s.deps);
        expect(swept.unsettled).toEqual([]);
        expect(swept.effects).toEqual([]);
        expect((await checkoutOf(s, 'order-rec-1'))).toMatchObject({ order: { state: 'refunded' }, refund: { state: 'done', attempts: 2 } });
        await sweep(s.deps);
        expect(s.payments.refunds).toHaveLength(1);
        expect(s.payments.payments.get('fake-1')?.refunded).toBe(387_200);
      });

      test('a refund the provider refuses is left to a person, who is told once', async () => {
        const s = studio({}, kind);
        await expiredHold(s, 'order-rec-1');
        started(await startCheckout(s.deps, recordingCart('order-rec-2')));
        s.payments.settle('fake-1', 'paid');
        s.payments.failNext(new PaymentError('rejected', 'refunds are switched off'));
        const result = handled(await s.notify('order-rec-1'));

        expect(result).toMatchObject({ state: 'awaiting-payment', unfinished: false });
        expect(names(result.effects)).toEqual(['slot-lost', 'studio-alert:slot-lost', 'studio-alert:refund-failed']);
        // The order waits for a person's refund, not for a payment: the form sent again opens no payment page,
        // and the sweep does not ask the provider about a payment it knows to be paid.
        expect(await startCheckout(s.deps, recordingCart('order-rec-1'))).toEqual({ ok: false, error: 'not-awaiting-payment', state: 'awaiting-payment' });
        expect((await checkoutOf(s, 'order-rec-1')).payment?.refunded).toBeUndefined();
        const swept = await sweep(s.deps);
        expect(swept.unsettled).toEqual([{ orderId: 'order-rec-1', what: 'refund', state: 'manual', error: 'rejected: refunds are switched off' }]);
        expect(swept.effects).toEqual([]);
        expect(s.payments.refunds).toEqual([]);
      });
    });

    describe('an invoicing failure', () => {
      const DOWN = { kind: 'unavailable', message: 'Fakturoid is in maintenance.', status: 503 } as const;

      test('does not hold the confirmation back, and the next delivery issues the one invoice', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, recordingCart('order-rec-1')));
        s.invoicing.failNext('createInvoice', DOWN);
        const first = handled(await s.settle('order-rec-1', 'paid'));

        expect(first).toMatchObject({ acknowledge: { status: 200 }, outcome: 'applied', state: 'paid', unfinished: true });
        expect(names(first.effects)).toEqual(CONFIRMED);
        expect(email(first.effects, 'order-confirmed').data.invoiceUrl).toBeUndefined();
        expect(s.invoicing.issued).toEqual([]);
        expect((await checkoutOf(s, 'order-rec-1')).settlement).toMatchObject({ booking: 'confirmed', confirmed: true, done: false, lastError: { step: 'invoice', kind: 'unavailable' } });

        s.clock.now += 5 * MINUTE;
        const second = handled(await s.notify('order-rec-1'));
        expect(second).toMatchObject({ outcome: 'duplicate', state: 'paid', unfinished: false, effects: [] });
        expect(s.invoicing.issued).toHaveLength(1);
        expect(s.invoicing.issued[0]).toMatchObject({ document: { paid: true, total: { amount: 387_200 } }, emails: 1 });
        expect(s.invoicing.issued[0]?.payments).toHaveLength(1);
        const settlement = (await checkoutOf(s, 'order-rec-1')).settlement;
        expect(settlement).toMatchObject({ done: true });
        expect(settlement?.lastError).toBeUndefined();

        // Nothing was charged, booked, linked or invoiced twice on the way.
        expect(s.payments.payments.size).toBe(1);
        expect(s.payments.refunds).toEqual([]);
        expect((await s.booking()).sessions).toHaveLength(1);
        expect(s.auth.links.size).toBe(1);
        expect(s.invoicing.calls.filter((call) => call === 'ensureCustomer')).toHaveLength(1);
        handled(await s.notify('order-rec-1'));
        expect(s.invoicing.issued).toHaveLength(1);
        expect(s.invoicing.issued[0]?.payments).toHaveLength(1);
      });

      test('at any step is taken up by the sweep from that step', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, tracksCart('order-mix-1')));
        s.invoicing.failNext('recordPayment', DOWN);
        s.invoicing.failNext('recordPayment', { kind: 'rate_limited', message: 'Too many requests.' });
        const first = handled(await s.settle('order-mix-1', 'paid'));
        expect(first).toMatchObject({ state: 'awaiting-files', unfinished: true });
        expect(s.invoicing.issued[0]?.document.paid).toBe(false);

        const still = await sweep(s.deps);
        expect(still.unsettled).toEqual([{ orderId: 'order-mix-1', what: 'settlement', state: 'pending', error: 'payment: rate_limited: Too many requests.' }]);
        expect(still.effects).toEqual([]);

        s.invoicing.failNext('sendInvoiceEmail', DOWN);
        expect((await sweep(s.deps)).unsettled).toMatchObject([{ error: 'email: unavailable: Fakturoid is in maintenance.' }]);
        expect(s.invoicing.issued[0]?.document.paid).toBe(true);

        const done = await sweep(s.deps);
        expect(done.unsettled).toEqual([]);
        expect(done.effects).toEqual([]);
        expect(s.invoicing.issued).toHaveLength(1);
        expect(s.invoicing.issued[0]).toMatchObject({ emails: 1 });
        expect(s.invoicing.issued[0]?.payments).toHaveLength(1);
        expect(s.invoicing.calls.filter((call) => call === 'createInvoice')).toHaveLength(1);
        expect((await checkoutOf(s, 'order-mix-1')).settlement?.done).toBe(true);
      });

      test('an adapter that throws is a failure like any other', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, tracksCart('order-mix-1')));
        const ensureCustomer = s.invoicing.ensureCustomer.bind(s.invoicing);
        s.invoicing.ensureCustomer = async () => {
          throw new Error('socket closed');
        };
        const first = handled(await s.settle('order-mix-1', 'paid'));
        expect(first.unfinished).toBe(true);
        expect(names(first.effects)).toEqual(CONFIRMED);
        expect((await checkoutOf(s, 'order-mix-1')).settlement?.lastError).toMatchObject({ step: 'customer', kind: 'unexpected', message: 'socket closed' });

        s.invoicing.ensureCustomer = ensureCustomer;
        expect(handled(await s.notify('order-mix-1'))).toMatchObject({ unfinished: false, effects: [] });
        expect(s.invoicing.issued[0]?.document.paid).toBe(true);
      });

      test('the provider is not asked to e-mail the invoice when that is switched off', async () => {
        const s = studio({ sendInvoiceEmail: false }, kind);
        started(await startCheckout(s.deps, tracksCart('order-mix-1')));
        expect(handled(await s.settle('order-mix-1', 'paid')).unfinished).toBe(false);
        expect(s.invoicing.issued[0]).toMatchObject({ document: { paid: true }, emails: 0 });
      });
    });

    describe('the sweep', () => {
      test('with nothing to do reports nothing', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, recordingCart('order-rec-1')));
        expect(await sweep(s.deps)).toEqual({ expiredHolds: [], cancelled: [], unsettled: [], overdue: [], skipped: [], effects: [] });
        expect((await s.booking()).holds).toHaveLength(1);
      });

      test('clears a hold that ran out, cancels its payment at the provider and the order, and tells the customer', async () => {
        const s = studio({}, kind);
        await expiredHold(s, 'order-rec-1');
        const swept = await sweep(s.deps);

        expect(swept).toMatchObject({ expiredHolds: ['order-rec-1'], cancelled: ['order-rec-1'], unsettled: [], overdue: [], skipped: [] });
        expect(names(swept.effects)).toEqual(['payment-not-completed']);
        expect(email(swept.effects, 'payment-not-completed').data.reason).toBe('expired');
        expect(s.payments.payments.get('fake-1')?.status).toBe('cancelled');
        expect((await checkoutOf(s, 'order-rec-1'))).toMatchObject({ order: { state: 'cancelled' }, payment: { status: 'cancelled' } });
        expect((await s.booking())).toEqual({ holds: [], sessions: [] });

        // Again, and with the provider's own notification of the cancellation: nothing more.
        expect(await sweep(s.deps)).toEqual({ expiredHolds: [], cancelled: [], unsettled: [], overdue: [], skipped: [], effects: [] });
        expect(handled(await s.notify('order-rec-1'))).toMatchObject({ outcome: 'duplicate', state: 'cancelled', effects: [] });
      });

      test('finds a payment that was made after all, and settles it', async () => {
        const s = studio({}, kind);
        await expiredHold(s, 'order-rec-1');
        // Paid at the provider; the notification has not come yet.
        s.payments.settle('fake-1', 'paid');
        const swept = await sweep(s.deps);

        expect(swept).toMatchObject({ expiredHolds: ['order-rec-1'], cancelled: [], unsettled: [] });
        expect(names(swept.effects)).toEqual(CONFIRMED);
        expect((await checkoutOf(s, 'order-rec-1'))).toMatchObject({ order: { state: 'paid' }, settlement: { booking: 'rebooked', done: true } });
        expect(handled(await s.notify('order-rec-1'))).toMatchObject({ outcome: 'duplicate', effects: [] });
        expect(s.invoicing.issued).toHaveLength(1);
      });

      test('leaves the order alone while the provider cannot be reached, and comes back', async () => {
        const s = studio({}, kind);
        await expiredHold(s, 'order-rec-1');
        s.payments.failNext();
        const first = await sweep(s.deps);
        expect(first).toMatchObject({ expiredHolds: ['order-rec-1'], cancelled: [], effects: [] });
        expect((await checkoutOf(s, 'order-rec-1')).order.state).toBe('awaiting-payment');
        expect((await sweep(s.deps)).cancelled).toEqual(['order-rec-1']);
      });

      test('cancels an order whose payment was never opened, without writing to anyone', async () => {
        const s = studio({}, kind);
        s.payments.failNext();
        await startCheckout(s.deps, recordingCart('order-rec-1'));
        s.clock.now += 11 * MINUTE;
        const swept = await sweep(s.deps);
        expect(swept).toMatchObject({ cancelled: ['order-rec-1'], effects: [] });
        expect(await startCheckout(s.deps, recordingCart('order-rec-1'))).toEqual({ ok: false, error: 'not-awaiting-payment', state: 'cancelled' });
      });

      test('does not cancel a payment whose hold still runs, nor an order for tracks; it reports those overdue', async () => {
        const s = studio({}, kind);
        started(await startCheckout(s.deps, tracksCart('order-mix-1')));
        s.clock.now += 72 * HOUR;
        started(await startCheckout(s.deps, recordingCart('order-rec-1', slot('09:00', '13:00', null, '2026-06-10'))));
        expect((await sweep(s.deps)).overdue).toEqual([]);

        s.clock.now += MINUTE;
        const swept = await sweep(s.deps);
        expect(swept).toMatchObject({ expiredHolds: [], cancelled: [], effects: [] });
        expect(swept.overdue.map((order) => order.id)).toEqual(['order-mix-1']);
        expect(s.payments.payments.get('fake-1')?.status).toBe('pending');
        expect((await s.booking()).holds).toHaveLength(1);

        // Paid late, it is an order like any other.
        expect(handled(await s.settle('order-mix-1', 'paid'))).toMatchObject({ state: 'awaiting-files', unfinished: false });
        expect((await sweep(s.deps)).overdue).toEqual([]);
      });
    });
  });
}
