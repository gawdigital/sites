// What a provider's event does to a stored payment, as a pure function: the provider sends the same result many
// times and in no promised order, and a booking must be confirmed or released exactly once.
import type { Money, PaymentEvent, PaymentStatus } from './provider.ts';

/** The payment as we keep it; whoever stores it writes the new record and performs the effect in one transaction. */
export interface PaymentRecord {
  provider: string;
  paymentId: string;
  reference: string;
  amount: Money;
  status: PaymentStatus;
  /** When the status last changed, in epoch milliseconds. */
  updatedAt: number;
}

/** What the booking must do, once: `confirm` the held slot, `release` it, or nothing. */
export type PaymentEffect = 'confirm' | 'release' | 'none';

/**
 * Why the effect is what it is:
 * - `applied`: the status moved;
 * - `duplicate`: the event repeats what is stored;
 * - `stale`: the event is older than what is stored (a `pending` after a `paid`);
 * - `conflict`: the event contradicts a final status (`paid` after `cancelled` or the reverse). The record stays;
 *   a person, or a refund, has to settle it: a `paid` event for a released slot means money was taken;
 * - `*_mismatch`: the event is not about this payment as we created it. Nothing changes.
 */
export type PaymentOutcome =
  | 'applied'
  | 'duplicate'
  | 'stale'
  | 'conflict'
  | 'provider_mismatch'
  | 'payment_mismatch'
  | 'reference_mismatch'
  | 'currency_mismatch'
  | 'amount_mismatch'
  | 'test_mismatch';

export interface PaymentTransition {
  record: PaymentRecord;
  effect: PaymentEffect;
  outcome: PaymentOutcome;
}

/** How far along a status is: an event may only move a payment forward. */
const RANK: Record<PaymentStatus, number> = { pending: 0, authorised: 1, paid: 2, cancelled: 2 };

const EFFECT: Record<PaymentStatus, PaymentEffect> = { pending: 'none', authorised: 'none', paid: 'confirm', cancelled: 'release' };

function mismatch(record: PaymentRecord, event: PaymentEvent, acceptTest: boolean): PaymentOutcome | undefined {
  if (event.provider !== record.provider) return 'provider_mismatch';
  if (event.paymentId !== record.paymentId) return 'payment_mismatch';
  if (event.reference !== record.reference) return 'reference_mismatch';
  if (event.amount.currency !== record.amount.currency) return 'currency_mismatch';
  if (event.amount.amount !== record.amount.amount) return 'amount_mismatch';
  if (event.test && !acceptTest) return 'test_mismatch';
  return undefined;
}

/**
 * Applies a provider's event to the stored payment. The effect is other than `none` at most once in a payment's
 * life: when it first becomes `paid` (`confirm`) or first becomes `cancelled` (`release`).
 *
 * `acceptTest` says whether test payments count (they do only where the gateway runs in test mode).
 */
export function applyPaymentEvent(
  record: PaymentRecord,
  event: PaymentEvent,
  now: number,
  { acceptTest = false }: { acceptTest?: boolean } = {},
): PaymentTransition {
  const keep = (outcome: PaymentOutcome): PaymentTransition => ({ record, effect: 'none', outcome });

  const wrong = mismatch(record, event, acceptTest);
  if (wrong) return keep(wrong);
  if (event.status === record.status) return keep('duplicate');
  if (RANK[event.status] < RANK[record.status]) return keep('stale');
  // Both final and different: the provider promises this never happens, so nothing is undone on its word alone.
  if (RANK[event.status] === RANK[record.status]) return keep('conflict');

  return { record: { ...record, status: event.status, updatedAt: now }, effect: EFFECT[event.status], outcome: 'applied' };
}

/** The record to store when a payment is created, before any event. */
export function newPaymentRecord(provider: string, paymentId: string, reference: string, amount: Money, now: number): PaymentRecord {
  return { provider, paymentId, reference, amount: { ...amount }, status: 'pending', updatedAt: now };
}
