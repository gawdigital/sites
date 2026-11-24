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
  /** How it was paid, in the provider's code, once the provider has said (`PaymentEvent.method`). */
  method?: string;
  /**
   * How much has been returned, in minor units: what the provider last reported (`PaymentEvent.refunded`), or
   * what our own successful refunds add up to (`noteRefund`) where it reports nothing. Left out: nothing known.
   */
  refunded?: number;
}

/** What the booking must do, once: `confirm` the held slot, `release` it, or nothing. */
export type PaymentEffect = 'confirm' | 'release' | 'none';

/**
 * Why the effect is what it is:
 * - `applied`: the status moved;
 * - `noted`: the status did not move, and the event told something new about the payment (how it was paid, how
 *   much has been returned): the record is to be stored, and nothing else follows;
 * - `duplicate`: the event repeats what is stored;
 * - `stale`: the event is older than what is stored (a `pending` after a `paid`);
 * - `conflict`: the event contradicts a final status (`paid` after `cancelled` or the reverse). The record stays;
 *   a person, or a refund, has to settle it: a `paid` event for a released slot means money was taken;
 * - `*_mismatch`: the event is not about this payment as we created it. Nothing changes.
 */
export type PaymentOutcome =
  | 'applied'
  | 'noted'
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
  if (event.status === record.status) {
    const noted = withDetails(record, event);
    return noted === record ? keep('duplicate') : { record: noted, effect: 'none', outcome: 'noted' };
  }
  if (RANK[event.status] < RANK[record.status]) return keep('stale');
  // Both final and different: the provider promises this never happens, so nothing is undone on its word alone.
  if (RANK[event.status] === RANK[record.status]) return keep('conflict');

  return { record: { ...withDetails(record, event), status: event.status, updatedAt: now }, effect: EFFECT[event.status], outcome: 'applied' };
}

/**
 * The record with what the event says beyond the status: the method, and the amount returned. The provider's
 * word replaces ours; an event that says nothing leaves what is stored. The same object when nothing is new.
 */
function withDetails(record: PaymentRecord, event: PaymentEvent): PaymentRecord {
  const method = event.method !== undefined && event.method !== record.method ? { method: event.method } : undefined;
  // A provider that says "nothing returned" tells nothing new about a record that knows of no refund.
  const refunded = event.refunded !== undefined && event.refunded !== (record.refunded ?? 0) ? { refunded: event.refunded } : undefined;
  return method || refunded ? { ...record, ...method, ...refunded } : record;
}

/**
 * The record after a refund of ours went through: the amount is added to what was returned before. For providers
 * that report no refund state (Comgate) this is the only trace of the refund; for those that do, the next event
 * confirms the figure.
 */
export function noteRefund(record: PaymentRecord, amount: number): PaymentRecord {
  return { ...record, refunded: (record.refunded ?? 0) + amount };
}

/** Whether the whole payment is known to have been returned. */
export function isRefunded(record: PaymentRecord): boolean {
  return record.refunded !== undefined && record.refunded >= record.amount.amount;
}

/** The record to store when a payment is created, before any event. */
export function newPaymentRecord(provider: string, paymentId: string, reference: string, amount: Money, now: number): PaymentRecord {
  return { provider, paymentId, reference, amount: { ...amount }, status: 'pending', updatedAt: now };
}
