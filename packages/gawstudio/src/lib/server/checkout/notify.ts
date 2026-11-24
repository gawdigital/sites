// A payment provider's server-to-server notification, from the raw body to everything that follows from it.
//
// The answer to the provider: the acknowledgement is due as soon as the payment's status is stored. Work that
// then fails (an invoice the provider's API refuses today, a refund that does not go through) does not withhold
// it: it stays noted on the order (`unfinished`) and is taken up by the next delivery of the notification or by
// the sweep. Only a notification that cannot be trusted or read, or an order another request is busy with, is
// answered with an error, which makes the provider send it again.
import { isPaymentError } from '../payments/index.ts';
import type { NotificationInput, PaymentEvent } from '../payments/index.ts';
import { alert, applyEvent, Busy } from './settle.ts';
import type { Run } from './settle.ts';
import { isUnfinished } from './store.ts';
import type { CheckoutDeps, NotificationResult } from './types.ts';

/**
 * Handles one notification. Safe to call any number of times for the same payment: what an earlier call did is
 * not done again, and what it could not do is tried again.
 *
 * - paid: the held slot becomes a session, the order moves on, the customer gets an account, an invoice with the
 *   payment on it, and the confirmation with the order's magic link.
 * - paid after the hold ran out: accepted when the slot is still free (it is taken again and confirmed);
 *   otherwise the order is marked for a refund, the provider's refund is called, and no invoice is issued.
 * - cancelled: the hold is released and the order cancelled.
 */
export async function handlePaymentNotification(deps: CheckoutDeps, input: NotificationInput): Promise<NotificationResult> {
  const run: Run = { deps, now: deps.now(), effects: [] };
  const acknowledge = deps.payments.notificationAck;

  let event: PaymentEvent;
  try {
    event = await deps.payments.parseNotification(input);
  } catch (error) {
    if (isPaymentError(error, 'unauthenticated')) return { ok: false, error: 'unauthenticated', status: 401, effects: [] };
    if (isPaymentError(error, 'malformed')) return { ok: false, error: 'malformed', status: 400, effects: [] };
    // A provider that is asked for the payment's status while parsing may be unreachable: it will send again.
    if (isPaymentError(error)) return { ok: false, error: 'provider-unavailable', status: 503, effects: [] };
    throw error;
  }

  const found = await deps.store.get(event.reference);
  if (!found) {
    // An order is stored before its payment is opened, so this payment is not one of ours. Sending it again
    // would change nothing: it is acknowledged, and a person is told.
    const detail = `A notification names payment ${event.paymentId} (${event.status}, ${event.amount.amount} ${event.amount.currency}) for the unknown reference ${event.reference}.`;
    return { ok: true, acknowledge, outcome: 'unknown-order', unfinished: false, effects: [alert('unknown-order', detail)] };
  }

  try {
    const { checkout, outcome } = await applyEvent(run, found, event);
    const unfinished = (checkout.settlement !== undefined && !checkout.settlement.done) || checkout.refund?.state === 'pending' || (checkout.payment?.status === 'cancelled' && isUnfinished(checkout));
    return { ok: true, acknowledge, orderId: checkout.order.id, outcome, state: checkout.order.state, unfinished, effects: run.effects };
  } catch (error) {
    // The effects of the steps that were saved before the other request got in are still the caller's to send.
    if (error instanceof Busy) return { ok: false, error: 'busy', status: 503, effects: run.effects };
    throw error;
  }
}
