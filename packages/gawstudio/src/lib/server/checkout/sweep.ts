// What a scheduled job does every few minutes: clears the holds that ran out, closes the unpaid payments behind
// them, takes up the work earlier calls left, and reports what the admin should look at.
//
// A payment is never called cancelled on our word alone. The provider is asked to cancel it; when it has, the
// order is cancelled; when it will not (the customer paid in that very minute, the payment is authorised, the
// provider cannot cancel), its status is read and applied like a notification, so a payment that did arrive goes
// the "paid after the hold ran out" way. Orders without a hold (tracks) are not cancelled here: they are reported
// as overdue once they have waited for their payment longer than the order settings allow.
import { expire } from '../booking/index.ts';
import { overdueOrders } from '../orders/index.ts';
import { isPaymentError } from '../payments/index.ts';
import type { PaymentEvent } from '../payments/index.ts';
import { applyEvent, Busy, progress, releaseOrder } from './settle.ts';
import type { Run } from './settle.ts';
import type { Checkout, CheckoutDeps, SweepResult, Unsettled } from './types.ts';

/** Closes the payment of an order whose hold ran out, or learns that it was paid after all. */
async function closeUnpaid(run: Run, checkout: Checkout): Promise<Checkout> {
  const { payments } = run.deps;
  const payment = checkout.payment;
  // The payment was never opened, so there is nothing to ask the provider.
  if (!payment) return releaseOrder(run, checkout);

  let event: PaymentEvent | undefined;
  try {
    if (payment.status === 'pending' && payments.cancel) {
      try {
        await payments.cancel(payment.paymentId);
        event = { provider: payment.provider, paymentId: payment.paymentId, reference: payment.reference, status: 'cancelled', amount: payment.amount, test: false };
      } catch (error) {
        if (!isPaymentError(error, 'rejected')) throw error;
      }
    }
    event ??= await payments.getPayment(payment.paymentId);
  } catch (error) {
    // Unreachable just now: the next sweep asks again.
    if (isPaymentError(error)) return checkout;
    throw error;
  }
  return (await applyEvent(run, checkout, event)).checkout;
}

function unsettledOf(checkout: Checkout): Unsettled[] {
  const orderId = checkout.order.id;
  const found: Unsettled[] = [];
  const { settlement, refund } = checkout;
  if (settlement && !settlement.done) {
    const error = settlement.lastError;
    found.push({ orderId, what: 'settlement', state: 'pending', ...(error ? { error: `${error.step}: ${error.kind}: ${error.message}` } : {}) });
  }
  if (refund && refund.state !== 'done') found.push({ orderId, what: 'refund', state: refund.state, ...(refund.lastError ? { error: refund.lastError } : {}) });
  return found;
}

/** One pass over everything unfinished. Safe to run as often as wanted, and alongside notifications. */
export async function sweep(deps: CheckoutDeps): Promise<SweepResult> {
  const now = deps.now();
  const run: Run = { deps, now, effects: [] };
  const result: SweepResult = { expiredHolds: [], cancelled: [], unsettled: [], overdue: [], skipped: [], effects: run.effects };

  result.expiredHolds = await deps.store.updateBooking((state) => ({
    state: expire(state, now),
    result: state.holds.filter((held) => held.expiresAt <= now).map((held) => held.id),
  }));

  const orders = [];
  for (const stored of await deps.store.unfinished()) {
    let checkout = stored;
    try {
      const waiting = checkout.order.state === 'awaiting-payment';
      if (waiting && checkout.slot && now >= checkout.slot.holdExpiresAt && checkout.payment?.status !== 'cancelled') checkout = await closeUnpaid(run, checkout);
      else checkout = await progress(run, checkout);
      if (waiting && checkout.order.state === 'cancelled') result.cancelled.push(checkout.order.id);
    } catch (error) {
      if (!(error instanceof Busy)) throw error;
      result.skipped.push(stored.order.id);
      continue;
    }
    result.unsettled.push(...unsettledOf(checkout));
    orders.push(checkout.order);
  }

  result.overdue = overdueOrders(orders, deps.settings.orders, new Date(now));
  return result;
}
