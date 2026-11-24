// Starting a checkout: a cart becomes an order waiting for its payment, and the customer is sent to pay.
//
// The rules chosen where the specification leaves room:
// - One order is one kind of work: one recording session, or mix and mastering tracks, or AI-assisted tracks. An
//   order has one flow, so a cart that mixes them is refused (`mixed-cart`) and the page sends them one by one.
// - A recording session is priced from the slot the booking offers at that instant (a block, the whole day, a
//   free window), never from what the form claims it is.
// - The caller's order id makes the call repeatable: the same form sent again returns the same payment page, and
//   an order whose payment could not be opened is taken up where it stopped (its hold is taken again if it ran
//   out). The same id with a different cart is refused. While one request opens the order's payment, another
//   for the same order answers `busy` (`paymentClaim`), so one order never opens two payments that both stay.
import { normaliseEmail } from '../auth/index.ts';
import { availability, busyOf, hold, localDateOf } from '../booking/index.ts';
import type { Refusal, SlotKind } from '../booking/index.ts';
import { createOrder, isCurrency, quote, transition } from '../orders/index.ts';
import type { CompanyDetails, Flow, Quote, QuoteRequest, SessionRequest } from '../orders/index.ts';
import { isPaymentError, newPaymentRecord } from '../payments/index.ts';
import { Busy, commit } from './settle.ts';
import type { Run } from './settle.ts';
import { LANGUAGES } from './types.ts';
import type { Checkout, CheckoutDeps, CheckoutRequest, Customer, HeldSlot, Problem, SlotChoice, StartResult } from './types.ts';

/** What an order id may look like: it travels in URLs and as the payment's reference. */
const ORDER_ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_NAME = 200;
const MINUTE = 60_000;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001F\u007F]/.test(value);

interface Valid {
  customer: Customer;
  company?: CompanyDetails;
}

/** The request's own fields; the cart is the quote's to judge. */
function validate(request: CheckoutRequest): { ok: true; value: Valid } | { ok: false; problems: Problem[] } {
  const problems: Problem[] = [];
  const bad = (code: string, path: string) => void problems.push({ code, path });

  if (typeof request.orderId !== 'string' || !ORDER_ID.test(request.orderId)) bad('invalid-order-id', 'orderId');
  if (typeof request.currency !== 'string' || !isCurrency(request.currency)) bad('invalid-currency', 'currency');

  const email = typeof request.customer?.email === 'string' ? normaliseEmail(request.customer.email) : undefined;
  if (email === undefined) bad('invalid-email', 'customer.email');
  if (!isText(request.customer?.name, MAX_NAME)) bad('invalid-name', 'customer.name');
  if (!LANGUAGES.includes(request.customer?.language)) bad('invalid-language', 'customer.language');

  const slot = request.recording;
  const tracks = request.tracks ?? [];
  if (!Array.isArray(tracks)) bad('invalid-tracks', 'tracks');
  else {
    if (slot && tracks.length > 0) bad('mixed-cart', '');
    else if (!slot && tracks.length === 0) bad('empty', '');
    // The shapes the fingerprint and the quote read: the values themselves are the quote's to judge.
    tracks.forEach((line: unknown, i) => {
      if (!isObject(line)) return bad('invalid-line', `tracks[${i}]`);
      const addOns = line.addOns;
      if (addOns === undefined) return;
      if (!Array.isArray(addOns)) return bad('invalid-addons', `tracks[${i}].addOns`);
      addOns.forEach((addOn: unknown, j) => {
        if (!isObject(addOn)) bad('invalid-addon', `tracks[${i}].addOns[${j}]`);
      });
    });
  }
  if (slot) {
    if (!Number.isSafeInteger(slot.start) || !Number.isSafeInteger(slot.end) || slot.end <= slot.start) bad('invalid-slot', 'recording');
    if (slot.technicianId !== null && typeof slot.technicianId !== 'string') bad('invalid-technician', 'recording.technicianId');
  }

  let company: CompanyDetails | undefined;
  if (request.company !== undefined && request.company !== null) {
    if (!isObject(request.company)) bad('invalid-company', 'company');
    else {
      const { name, companyId, vatId } = request.company;
      for (const [field, value] of Object.entries({ name, companyId, vatId })) {
        if (value !== undefined && value !== '' && !isText(value, MAX_NAME)) bad('invalid-company', `company.${field}`);
      }
      // Only text is read from here on; what is not text was reported above.
      const [nameText, idText, vatText] = [name, companyId, vatId].map((value) => (typeof value === 'string' ? value.trim() : ''));
      // The invoice names a company by its name: a number alone bills nobody.
      if (!nameText && (idText || vatText)) bad('company-name-missing', 'company.name');
      if (nameText) company = { name: nameText, ...(idText ? { companyId: idText } : {}), ...(vatText ? { vatId: vatText } : {}) };
    }
  }

  if (problems.length > 0 || email === undefined) return { ok: false, problems };
  return { ok: true, value: { customer: { email, name: request.customer.name.trim(), language: request.customer.language }, ...(company ? { company } : {}) } };
}

/** The cart, canonically: what makes two requests under one id the same request. */
function fingerprintOf(request: CheckoutRequest, valid: Valid): string {
  const slot = request.recording;
  return JSON.stringify([
    valid.customer.email,
    valid.customer.name,
    valid.customer.language,
    request.currency,
    slot ? [slot.start, slot.end, slot.technicianId] : null,
    (request.tracks ?? []).map((line) => [line.service, line.technician, line.tracks, (line.addOns ?? []).map((addOn) => [addOn.id, addOn.tracks ?? null])]),
    valid.company ? [valid.company.name, valid.company.companyId ?? null, valid.company.vatId ?? null] : null,
  ]);
}

const AI_KINDS: readonly string[] = ['ai-mix', 'ai-mastering'];

/** The one flow of a priced cart, or `undefined` when it mixes AI-assisted work with the technicians' own. */
function flowOf(priced: Quote, recording: boolean): Flow | undefined {
  if (recording) return 'recording';
  const ai = priced.work.filter((item) => AI_KINDS.includes(item.kind)).length;
  if (ai === 0) return 'classic';
  return ai === priced.work.length ? 'ai' : undefined;
}

function sessionRequest(kind: SlotKind, slot: SlotChoice, date: string): SessionRequest {
  if (kind === 'block') return { type: 'block', date };
  if (kind === 'wholeDay') return { type: 'day', date };
  return { type: 'window', minutes: (slot.end - slot.start) / MINUTE, date };
}

/**
 * How long a request's claim on opening an order's payment keeps other requests for the order out. Far longer
 * than a provider's answer takes; a claim this old belongs to a request that died, and is taken over.
 */
export const PAYMENT_CLAIM_MS = 2 * MINUTE;

const unclaimed = ({ paymentClaim: _, ...checkout }: Checkout): Checkout => checkout;

/** Cancels a payment that no order records, where the provider can. Best effort: it expires unpaid otherwise. */
async function withdraw(deps: CheckoutDeps, paymentId: string): Promise<void> {
  if (!deps.payments.cancel) return;
  try {
    await deps.payments.cancel(paymentId);
  } catch (error) {
    if (!isPaymentError(error)) throw error;
  }
}

/** Holds the order's slot under the order's id; asked again while the hold runs, it returns that hold. */
async function placeHold(deps: CheckoutDeps, orderId: string, slot: SlotChoice, kind: SlotKind, now: number): Promise<{ ok: true; slot: HeldSlot } | { ok: false; reason: Refusal }> {
  const context = await deps.booking();
  const request = { id: orderId, start: slot.start, end: slot.end, technicianId: slot.technicianId };
  const held = await deps.store.updateBooking(
    (state) => {
      const outcome = hold(state, request, context, now);
      return { state: outcome.state, result: outcome };
    },
    { ids: [orderId] },
  );
  if (!held.ok) return { ok: false, reason: held.reason };
  return { ok: true, slot: { start: slot.start, end: slot.end, technicianId: slot.technicianId, kind, holdExpiresAt: held.hold.expiresAt } };
}

/**
 * Validates and prices a cart, holds the slot of a recording session, creates the order and its payment, and
 * returns where to send the customer. Nothing is e-mailed at this point: `effects` is empty, and there for the
 * shape all three use cases share.
 */
export async function startCheckout(deps: CheckoutDeps, request: CheckoutRequest): Promise<StartResult> {
  const now = deps.now();
  const run: Run = { deps, now, effects: [] };
  const checked = validate(request);
  if (!checked.ok) return { ok: false, error: 'invalid', problems: checked.problems };
  const { customer, company } = checked.value;
  const { orderId } = request;
  const fingerprint = fingerprintOf(request, checked.value);

  try {
    let checkout = await deps.store.get(orderId);
    if (checkout) {
      if (checkout.fingerprint !== fingerprint) return { ok: false, error: 'order-exists' };
      if (checkout.order.state !== 'awaiting-payment') return { ok: false, error: 'not-awaiting-payment', state: checkout.order.state };
      // Paid, with the slot lost: the order waits for its refund, not for a payment (see `settlePaid`).
      if (checkout.settlement || checkout.refund) return { ok: false, error: 'not-awaiting-payment', state: checkout.order.state };
      if (checkout.payment && checkout.redirectUrl) return { ok: true, orderId, redirectUrl: checkout.redirectUrl, resumed: true, effects: [] };
      // Another request is opening this order's payment right now.
      if (checkout.paymentClaim && now - checkout.paymentClaim.at < PAYMENT_CLAIM_MS) return { ok: false, error: 'busy' };
      // The order is there and its payment is not: the provider failed last time. The hold may have run out since.
      const claimed: Checkout = { ...checkout, paymentClaim: { at: now } };
      if (checkout.slot) {
        const held = await placeHold(deps, orderId, checkout.slot, checkout.slot.kind, now);
        if (!held.ok) return { ok: false, error: 'unavailable', reason: held.reason };
        claimed.slot = held.slot;
      }
      // The claim is a conditional save: of two requests that read the order together, one gets past here.
      checkout = await commit(run, claimed);
    } else {
      const choice = request.recording;
      let kind: SlotKind | undefined;
      const cart: QuoteRequest = { currency: request.currency, ...(company ? { company } : {}) };
      if (choice) {
        const context = await deps.booking();
        const date = localDateOf(choice.start, context.settings.timeZone);
        const [day] = availability(date, context.settings, busyOf(await deps.store.booking(), context, now, orderId), context.technicians, now);
        kind = day?.slots.find((offered) => offered.start === choice.start && offered.end === choice.end)?.kind;
        if (!kind) return { ok: false, error: 'unavailable', reason: 'unavailable' };
        cart.recording = [sessionRequest(kind, choice, date)];
      } else {
        cart.tracks = request.tracks ?? [];
      }

      const priced = quote(deps.catalogue, cart);
      if (!priced.ok) return { ok: false, error: 'invalid', problems: priced.errors };
      const flow = flowOf(priced.quote, choice !== undefined);
      if (!flow) return { ok: false, error: 'invalid', problems: [{ code: 'mixed-cart', path: 'tracks' }] };
      if (!(priced.quote.total > 0)) return { ok: false, error: 'invalid', problems: [{ code: 'nothing-to-pay', path: '' }] };

      let slot: HeldSlot | undefined;
      if (choice && kind) {
        const held = await placeHold(deps, orderId, choice, kind, now);
        if (!held.ok) return { ok: false, error: 'unavailable', reason: held.reason };
        slot = held.slot;
      }

      const at = new Date(now);
      const waiting = transition(createOrder(orderId, flow, at), 'awaiting-payment', at);
      if (!waiting.ok) throw new Error(`checkout: a new ${flow} order cannot wait for its payment`);
      const fresh: Checkout = { version: 1, fingerprint, createdAt: now, order: waiting.order, customer, quote: priced.quote, ...(slot ? { slot } : {}), paymentClaim: { at: now }, alerts: [] };
      // Stored before the payment is opened: an event can then never name an order that is not there. Stored
      // with the claim on opening it, so that the same form sent again meanwhile answers `busy`.
      if (!(await deps.store.insert(fresh))) return { ok: false, error: 'busy' };
      checkout = fresh;
    }

    const amount = { amount: checkout.quote.total, currency: checkout.quote.currency };
    const expiry = deps.settings.paymentExpiryMinutes;
    let created;
    try {
      created = await deps.payments.createPayment({
        amount,
        reference: orderId,
        label: deps.settings.paymentLabel,
        customerEmail: checkout.customer.email,
        customerName: checkout.customer.name,
        language: checkout.customer.language,
        returnUrls: deps.returnUrls(orderId, checkout.customer.language),
        ...(expiry !== undefined ? { expiresInMinutes: expiry } : {}),
      });
    } catch (error) {
      if (!isPaymentError(error)) throw error;
      // The claim is let go so that the form can be sent again at once; should this save lose, it runs out.
      await deps.store.save(unclaimed(checkout));
      // The hold is left to run out by itself, so that trying again within its time keeps the slot.
      return { ok: false, error: 'payment-unavailable', retryable: error.kind === 'transport' };
    }
    const recorded = await deps.store.save({ ...unclaimed(checkout), payment: newPaymentRecord(deps.payments.name, created.paymentId, orderId, amount, now), redirectUrl: created.redirectUrl });
    if (!recorded) {
      // Another request changed the order while this payment was being opened (it took over a claim that had run
      // out, or the sweep closed the order). Nobody was sent to this payment and no order will record it: it is
      // cancelled where the provider can, and otherwise left to expire there unpaid.
      await withdraw(deps, created.paymentId);
      return { ok: false, error: 'busy' };
    }
    return { ok: true, orderId, redirectUrl: created.redirectUrl, resumed: false, effects: [] };
  } catch (error) {
    if (error instanceof Busy) return { ok: false, error: 'busy' };
    throw error;
  }
}
