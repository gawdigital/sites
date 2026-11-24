// What a payment's event does to an order, as steps that can each be repeated. `applyEvent` stores the payment's
// new status first, in one save with the note of what is owed; `progress` then works that off and is what a
// notification delivered again, and the sweep, call to take up whatever an earlier call left.
//
// Why a step is safe to repeat:
// - the payment's effect comes from `applyPaymentEvent`, which gives `confirm` or `release` once in its life;
// - the session is confirmed under the order's id, and `confirm` returns the same session when asked twice;
// - the invoice is found or created by the order's reference, and a paid invoice takes no second payment;
// - every other step writes its marker in the save that follows it, and that save is refused when another
//   request got there first (`Busy`): the loser stops, and effects are handed out only after their save.
// What this cannot give: an e-mail effect is returned by the one call that completed its step. A caller that
// loses that result has lost the e-mail, so it should queue the effects before it answers the provider.
import { accountForOrder, issueMagicLink } from '../auth/index.ts';
import { confirm, hold, release } from '../booking/index.ts';
import type { BookingContext, BookingState, Refusal, Session } from '../booking/index.ts';
import type { InvoiceLine, InvoicingError, Result } from '../invoicing/index.ts';
import { pragueDate, transition } from '../orders/index.ts';
import type { Order, OrderState, QuoteLine } from '../orders/index.ts';
import { applyPaymentEvent, isPaymentError } from '../payments/index.ts';
import type { PaymentEvent, PaymentOutcome } from '../payments/index.ts';
import type { AlertProblem, Amount, Checkout, CheckoutDeps, Effect, HeldSlot, InvoiceStep, Recipient, Settlement } from './types.ts';

/** One call of a use case: its dependencies, its one reading of the clock, and the effects gathered so far. */
export interface Run {
  deps: CheckoutDeps;
  now: number;
  effects: Effect[];
}

/** Another request saved the order first: this one stops and leaves the rest to it, or to the next delivery. */
export class Busy extends Error {
  override readonly name = 'Busy';
}

export async function commit(run: Run, checkout: Checkout): Promise<Checkout> {
  const saved = await run.deps.store.save(checkout);
  if (!saved) throw new Busy(`order ${checkout.order.id} was changed by another request`);
  return saved;
}

export const customerOf = (checkout: Checkout): Recipient => ({ kind: 'customer', ...checkout.customer });

export const totalOf = (checkout: Checkout): Amount => ({ amount: checkout.quote.total, currency: checkout.quote.currency });

const STUDIO: Recipient = { kind: 'studio' };

export function alert(problem: AlertProblem, detail: string, orderId?: string): Effect {
  return { type: 'email', id: `${orderId ?? 'unknown'}:studio-alert:${problem}`, to: STUDIO, template: 'studio-alert', data: { ...(orderId ? { orderId } : {}), problem, detail } };
}

/** Raises a studio alert unless this order already raised it: for problems an event delivered again would repeat. */
async function alertOnce(run: Run, checkout: Checkout, problem: AlertProblem, key: string, detail: string): Promise<Checkout> {
  if (checkout.alerts.includes(key)) return checkout;
  const saved = await commit(run, { ...checkout, alerts: [...checkout.alerts, key] });
  run.effects.push(alert(problem, detail, checkout.order.id));
  return saved;
}

/** The order moved on; a move its flow does not allow means the stored data contradicts itself. */
function advance(order: Order, to: OrderState, now: number): Order {
  const moved = transition(order, to, new Date(now));
  if (!moved.ok) throw new Error(`checkout: order ${order.id} cannot go from ${order.state} to ${to}`);
  return moved.order;
}

/**
 * Applies a provider's event to an order, and does what follows from it. An event that changes nothing still
 * takes up unfinished work, which is what makes a notification delivered again the retry.
 */
export async function applyEvent(run: Run, checkout: Checkout, event: PaymentEvent): Promise<{ checkout: Checkout; outcome: PaymentOutcome }> {
  const orderId = checkout.order.id;
  if (!checkout.payment) {
    // A payment whose creation never answered us: nobody was sent to it, so it is reported, not adopted.
    const detail = `Payment ${event.paymentId} (${event.status}) names order ${orderId}, which has no payment on record.`;
    return { checkout: await alertOnce(run, checkout, 'payment-mismatch', `no-payment:${event.paymentId}`, detail), outcome: 'payment_mismatch' };
  }

  const applied = applyPaymentEvent(checkout.payment, event, run.now, { acceptTest: run.deps.settings.acceptTestPayments });
  switch (applied.outcome) {
    case 'applied': {
      const settlement: Settlement = { booking: checkout.slot ? 'pending' : 'none', done: false };
      checkout = await commit(run, { ...checkout, payment: applied.record, ...(applied.effect === 'confirm' ? { settlement } : {}) });
      break;
    }
    case 'duplicate':
    case 'stale':
      break;
    case 'conflict': {
      const detail = `Payment ${event.paymentId} of order ${orderId} is ${checkout.payment.status} here and ${event.status} at the provider.`;
      return { checkout: await alertOnce(run, checkout, 'payment-conflict', `conflict:${event.status}`, detail), outcome: applied.outcome };
    }
    default: {
      const detail = `An event for order ${orderId} does not match its payment (${applied.outcome}): payment ${event.paymentId}, ${event.status}, ${event.amount.amount} ${event.amount.currency}${event.test ? ', test' : ''}.`;
      return { checkout: await alertOnce(run, checkout, 'payment-mismatch', `${applied.outcome}:${event.paymentId}`, detail), outcome: applied.outcome };
    }
  }
  return { checkout: await progress(run, checkout), outcome: applied.outcome };
}

/** Works off whatever the order's stored state says is owed. Does nothing when nothing is. */
export async function progress(run: Run, checkout: Checkout): Promise<Checkout> {
  if (checkout.payment?.status === 'cancelled' && checkout.order.state === 'awaiting-payment') checkout = await releaseOrder(run, checkout);
  if (checkout.payment?.status === 'paid' && checkout.settlement && !checkout.settlement.done) checkout = await settlePaid(run, checkout);
  if (checkout.refund?.state === 'pending') checkout = await refund(run, checkout);
  return checkout;
}

/** The payment failed or was given up: the slot is free again and the order is cancelled. */
export async function releaseOrder(run: Run, checkout: Checkout): Promise<Checkout> {
  const { slot, order } = checkout;
  if (slot) await run.deps.store.updateBooking((state) => ({ state: release(state, order.id), result: undefined }));
  const saved = await commit(run, { ...checkout, order: advance(order, 'cancelled', run.now) });
  // Without a payment the customer never reached the provider and was told so on the spot: nothing to write.
  if (checkout.payment) {
    const reason = slot && run.now >= slot.holdExpiresAt ? 'expired' : 'cancelled';
    run.effects.push({
      type: 'email',
      id: `${order.id}:payment-not-completed`,
      to: customerOf(checkout),
      template: 'payment-not-completed',
      data: { orderId: order.id, reason, ...(slot ? { slot: { start: slot.start, end: slot.end } } : {}) },
    });
  }
  return saved;
}

type Secured = { ok: true; session: Session; late: boolean } | { ok: false; reason: Refusal };

/**
 * Turns the paid hold into a session, in one change of the booking state.
 *
 * Payment after the hold ran out: `confirm` then answers `expired` (or `not-found`, once the hold was cleared).
 * The slot is taken again if it is still free, and confirmed: the customer paid for it and nobody else has it.
 * The lead time is not asked again (the customer met it when they chose the slot); everything else is: another
 * hold or session, the calendar, the technician, and a slot that has begun is not given. When the slot cannot
 * be had, the answer is the refusal and the caller refunds.
 */
function secure(state: BookingState, id: string, slot: HeldSlot, context: BookingContext, now: number): { state: BookingState; result: Secured } {
  const first = confirm(state, id, context, now);
  if (first.ok) return { state: first.state, result: { ok: true, session: first.session, late: false } };
  if (first.reason !== 'expired' && first.reason !== 'not-found') return { state: first.state, result: { ok: false, reason: first.reason } };

  const lenient: BookingContext = { ...context, settings: { ...context.settings, leadTimeMinutes: 0 } };
  const again = hold(first.state, { id, start: slot.start, end: slot.end, technicianId: slot.technicianId }, lenient, now);
  if (!again.ok) return { state: again.state, result: { ok: false, reason: again.reason } };
  const second = confirm(again.state, id, context, now);
  return second.ok
    ? { state: second.state, result: { ok: true, session: second.session, late: true } }
    : { state: second.state, result: { ok: false, reason: second.reason } };
}

const UNITS: Record<QuoteLine['unit'], string | undefined> = { session: undefined, hour: 'h', track: 'track', discount: undefined };

const invoiceLine = (line: QuoteLine): InvoiceLine => {
  const unit = UNITS[line.unit];
  return { name: line.description, quantity: line.quantity, ...(unit ? { unit } : {}), unitPrice: line.unitPrice, vatRate: line.vatRateBp / 100 };
};

/** Our key for a billing identity: the account, and the company when the order is for one. */
function billingReference(accountId: string, checkout: Checkout): string {
  const company = checkout.quote.company;
  return company?.name ? `account:${accountId}:company:${company.companyId ?? company.name}` : `account:${accountId}`;
}

const invoiceDone = (settlement: Settlement, sendEmail: boolean): boolean =>
  settlement.invoiceId !== undefined && settlement.invoicePaid === true && (!sendEmail || settlement.invoiceEmailed === true);

/**
 * The invoice for a paid order: the customer at the provider, the invoice (found by the order's reference when
 * it was already issued), the payment on it, and the provider's e-mail. Stops at the first failure and notes
 * it; the steps already made are not made again.
 */
async function invoice(run: Run, checkout: Checkout, accountId: string): Promise<Checkout> {
  const { deps, now } = run;
  const { invoicing, settings } = deps;
  const orderId = checkout.order.id;
  const payment = checkout.payment!;
  const { quote } = checkout;
  let step: InvoiceStep = 'customer';

  const mark = (changes: Partial<Settlement>): Promise<Checkout> => commit(run, { ...checkout, settlement: { ...checkout.settlement!, ...changes } });
  const failed = (error: InvoicingError): Promise<Checkout> => mark({ lastError: { step, kind: error.kind, message: error.message, at: now } });
  /** The value, or `undefined` after noting the failure. */
  const taken = async <T>(result: Result<T>): Promise<{ value: T } | undefined> => {
    if (result.ok) return { value: result.value };
    checkout = await failed(result.error);
    return undefined;
  };

  try {
    if (!checkout.settlement!.invoiceCustomerId) {
      const company = quote.company;
      const customer = await taken(
        await invoicing.ensureCustomer({
          reference: billingReference(accountId, checkout),
          name: checkout.customer.name,
          email: checkout.customer.email,
          ...(company?.name ? { company: { name: company.name, ...(company.companyId ? { companyId: company.companyId } : {}), ...(company.vatId ? { vatId: company.vatId } : {}) } } : {}),
        }),
      );
      if (!customer) return checkout;
      checkout = await mark({ invoiceCustomerId: customer.value.id });
    }

    const paidOn = pragueDate(new Date(payment.updatedAt));
    if (!checkout.settlement!.invoiceId) {
      step = 'invoice';
      const issuedOn = pragueDate(new Date(now));
      const exchangeRate = await deps.exchangeRate?.(quote.currency, paidOn);
      const issued = await taken(
        await invoicing.createInvoice({
          orderReference: orderId,
          customerId: checkout.settlement!.invoiceCustomerId!,
          currency: quote.currency,
          priceMode: quote.pricesIncludeVat ? 'gross' : 'net',
          lines: quote.lines.map(invoiceLine),
          language: checkout.customer.language,
          tag: settings.invoiceTag,
          issuedOn,
          // Paid before the work is done: the day of the payment is the day of the taxable supply.
          ...(paidOn !== issuedOn ? { taxableSupplyOn: paidOn } : {}),
          ...(exchangeRate ? { exchangeRate } : {}),
          ...(settings.invoiceNote ? { note: settings.invoiceNote } : {}),
          ...(settings.invoicePaymentMethod ? { paymentMethod: settings.invoicePaymentMethod } : {}),
        }),
      );
      if (!issued) return checkout;
      const { document } = issued.value;
      checkout = await mark({ invoiceId: document.id, invoiceUrl: document.publicUrl });
      if (document.total.amount !== payment.amount.amount || document.total.currency !== payment.amount.currency) {
        const detail = `Invoice ${document.number} of order ${orderId} is for ${document.total.amount} ${document.total.currency}; ${payment.amount.amount} ${payment.amount.currency} was paid.`;
        run.effects.push(alert('invoice-total-mismatch', detail, orderId));
      }
    }

    if (!checkout.settlement!.invoicePaid) {
      step = 'payment';
      const recorded = await taken(await invoicing.recordPayment(checkout.settlement!.invoiceId!, { paidOn, amount: totalOf(checkout) }));
      if (!recorded) return checkout;
      checkout = await mark({ invoicePaid: true });
    }

    if (settings.sendInvoiceEmail && !checkout.settlement!.invoiceEmailed) {
      step = 'email';
      const sent = await taken(await invoicing.sendInvoiceEmail(checkout.settlement!.invoiceId!));
      if (!sent) return checkout;
      checkout = await mark({ invoiceEmailed: true });
    }
  } catch (error) {
    if (error instanceof Busy) throw error;
    // An adapter that throws instead of answering: noted like any failure, and retried like one.
    return failed({ kind: 'unexpected', message: error instanceof Error ? error.message : String(error) });
  }

  if (checkout.settlement!.lastError) {
    const { lastError: _, ...settlement } = checkout.settlement!;
    checkout = await commit(run, { ...checkout, settlement });
  }
  return checkout;
}

/**
 * Everything a paid order is owed, in order: the session (recording), the order's state, the customer's account,
 * the invoice with its payment, the confirmation with the order's magic link.
 *
 * A failing invoice does not hold the confirmation back: the customer has paid and is told so; the invoice
 * follows when invoicing works again (the next notification or sweep).
 */
async function settlePaid(run: Run, checkout: Checkout): Promise<Checkout> {
  const { deps, now } = run;
  const orderId = checkout.order.id;
  const { slot } = checkout;

  if (slot && checkout.settlement!.booking === 'pending') {
    const context = await deps.booking();
    const secured = await deps.store.updateBooking((state) => secure(state, orderId, slot, context, now));
    if (!secured.ok) {
      // The slot went to someone else, or the calendar took it: the money goes back and no invoice is issued.
      const saved = await commit(run, {
        ...checkout,
        order: advance(checkout.order, 'paid', now),
        settlement: { ...checkout.settlement!, booking: 'lost', done: true },
        refund: { reason: 'slot-lost', detail: secured.reason, amount: totalOf(checkout), state: 'pending', attempts: 0 },
      });
      const window = { start: slot.start, end: slot.end };
      run.effects.push(
        { type: 'email', id: `${orderId}:slot-lost`, to: customerOf(checkout), template: 'slot-lost', data: { orderId, slot: window, amount: totalOf(checkout) } },
        alert('slot-lost', `Order ${orderId} was paid, and its slot could not be confirmed (${secured.reason}); the payment is being refunded.`, orderId),
      );
      return saved;
    }
    checkout = await commit(run, { ...checkout, session: secured.session, settlement: { ...checkout.settlement!, booking: secured.late ? 'rebooked' : 'confirmed' } });
  }

  if (checkout.order.state === 'awaiting-payment') {
    let order = advance(checkout.order, 'paid', now);
    // A classic order now waits for its files. A recording order stays paid until its session; an AI order
    // stays paid until its draft is started, which is the `order-paid` effect's business.
    if (order.flow === 'classic') order = advance(order, 'awaiting-files', now);
    checkout = await commit(run, { ...checkout, order });
  }

  let accountId = checkout.settlement!.accountId;
  if (!accountId) {
    const ensured = await accountForOrder(deps.auth, checkout.customer.email, now);
    if (!ensured) throw new Error(`checkout: order ${orderId} has no usable address`);
    accountId = ensured.account.id;
    checkout = await commit(run, { ...checkout, settlement: { ...checkout.settlement!, accountId } });
  }

  if (!invoiceDone(checkout.settlement!, deps.settings.sendInvoiceEmail)) checkout = await invoice(run, checkout, accountId);

  if (!checkout.settlement!.confirmed) {
    const link = await issueMagicLink(deps.auth, { email: checkout.customer.email, purpose: { kind: 'order', orderId }, now, settings: deps.settings.auth });
    if (!link) throw new Error(`checkout: order ${orderId} has no usable address`);
    checkout = await commit(run, { ...checkout, settlement: { ...checkout.settlement!, confirmed: true } });
    const { flow } = checkout.order;
    const session = checkout.session ? { session: checkout.session } : {};
    const total = totalOf(checkout);
    const invoiceUrl = checkout.settlement!.invoiceUrl;
    run.effects.push(
      {
        type: 'email',
        id: `${orderId}:order-confirmed`,
        to: customerOf(checkout),
        template: 'order-confirmed',
        data: { orderId, flow, lines: checkout.quote.lines, total, ...session, link: { token: link.token, expiresAt: link.expiresAt }, ...(invoiceUrl ? { invoiceUrl } : {}) },
      },
      {
        type: 'email',
        id: `${orderId}:studio-new-order`,
        to: STUDIO,
        template: 'studio-new-order',
        data: { orderId, flow, total, customer: { name: checkout.customer.name, email: checkout.customer.email }, ...session },
      },
      { type: 'order-paid', id: `${orderId}:order-paid`, orderId, flow, ...session },
    );
  }

  if (invoiceDone(checkout.settlement!, deps.settings.sendInvoiceEmail)) checkout = await commit(run, { ...checkout, settlement: { ...checkout.settlement!, done: true } });
  return checkout;
}

/**
 * Returns the payment of a lost slot. A provider that cannot be reached is asked again by the next call, up to
 * `refundAttempts` times; a refusal, or the last failed attempt, leaves the refund to a person (`manual`) and
 * says so to the studio. A refund is always the whole amount under one reference, so a provider that did carry
 * out an attempt we never heard back from refuses the next one as more than was paid, and that ends as `manual`
 * too: never as money returned twice.
 */
async function refund(run: Run, checkout: Checkout): Promise<Checkout> {
  const { deps, now } = run;
  const owed = checkout.refund!;
  const orderId = checkout.order.id;
  const attempts = owed.attempts + 1;
  try {
    await deps.payments.refund({ paymentId: checkout.payment!.paymentId, amount: owed.amount, reference: `${orderId}-refund` });
  } catch (error) {
    if (!isPaymentError(error)) throw error;
    const again = error.kind === 'transport' && attempts < deps.settings.refundAttempts;
    const saved = await commit(run, { ...checkout, refund: { ...owed, attempts, state: again ? 'pending' : 'manual', lastError: `${error.kind}: ${error.message}` } });
    if (!again) run.effects.push(alert('refund-failed', `The refund of order ${orderId} (${owed.amount.amount} ${owed.amount.currency}) did not go through: ${error.message}. It has to be made by hand.`, orderId));
    return saved;
  }
  const { lastError: _, ...rest } = owed;
  return commit(run, { ...checkout, order: advance(checkout.order, 'refunded', now), refund: { ...rest, attempts, state: 'done' } });
}
