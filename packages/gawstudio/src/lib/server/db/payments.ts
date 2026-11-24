// Payments on D1: `PaymentRecord` (`../payments/reconcile.ts`) and the effect each payment still owes.
//
// `applyPaymentEvent` is pure and says what an event does: the new record, and whether the booking must be
// confirmed or released, once. Its contract asks that the record and the effect be written together. The effect
// is a change to the booking state, which has its own serialisation, so the two cannot be one statement; instead
// `apply` writes the new status and the effect owed in one UPDATE that only the first of two deliveries of the
// same event wins, and `effectDone` marks the effect once it has been performed. A Worker that dies in between
// leaves a row that `owedEffects` finds, and performing an effect twice is harmless (`confirm` and `release` in
// `../booking/holds.ts` both repeat safely).
import { PAYMENT_STATUSES } from '../payments/provider.ts';
import type { PaymentEffect, PaymentRecord, PaymentTransition } from '../payments/reconcile.ts';
import { changesOf, oneOf, rowsOf } from './d1.ts';
import type { D1Like } from './d1.ts';

interface PaymentRow {
  provider: string;
  payment_id: string;
  reference: string;
  amount: number;
  currency: string;
  status: string;
  created_at: number;
  updated_at: number;
  effect: string;
  effect_done_at: number | null;
}

const EFFECTS: readonly PaymentEffect[] = ['confirm', 'release', 'none'];

const record = (row: PaymentRow): PaymentRecord => ({
  provider: row.provider,
  paymentId: row.payment_id,
  reference: row.reference,
  amount: { amount: row.amount, currency: row.currency },
  status: oneOf(PAYMENT_STATUSES, row.status, 'payments.status'),
  updatedAt: row.updated_at,
});

/** A payment whose effect on the booking has not been marked done. */
export interface OwedEffect {
  record: PaymentRecord;
  effect: Exclude<PaymentEffect, 'none'>;
}

export class PaymentRepository {
  readonly #db: D1Like;

  constructor(db: D1Like) {
    this.#db = db;
  }

  /** Stores a payment just created at the provider (`newPaymentRecord`); `false` when it is already there. */
  async insert(payment: PaymentRecord): Promise<boolean> {
    const result = await this.#db
      .prepare(
        `INSERT INTO payments (provider, payment_id, reference, amount, currency, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .bind(payment.provider, payment.paymentId, payment.reference, payment.amount.amount, payment.amount.currency, payment.status, payment.updatedAt, payment.updatedAt)
      .run();
    return changesOf(result) === 1;
  }

  async get(provider: string, paymentId: string): Promise<PaymentRecord | undefined> {
    const row = await this.#db.prepare('SELECT * FROM payments WHERE provider = ? AND payment_id = ?').bind(provider, paymentId).first<PaymentRow>();
    return row ? record(row) : undefined;
  }

  /** Every payment made for one of our references (an order may be paid in several attempts), oldest first. */
  async ofReference(reference: string): Promise<PaymentRecord[]> {
    const result = await this.#db
      .prepare('SELECT * FROM payments WHERE reference = ? ORDER BY created_at, provider, payment_id')
      .bind(reference)
      .all<PaymentRow>();
    return rowsOf<PaymentRow>(result).map(record);
  }

  /**
   * Stores what `applyPaymentEvent` decided for the record `previous`. `true` for the one caller that moved the
   * payment on from `previous.status`: that caller performs `transition.effect` and then calls `effectDone`.
   * `false` when the transition changes nothing (any outcome but `applied`) or another delivery of the event
   * got there first; the caller then does nothing.
   */
  async apply(previous: PaymentRecord, transition: PaymentTransition): Promise<boolean> {
    if (transition.outcome !== 'applied') return false;
    const { record: next, effect } = transition;
    const result = await this.#db
      .prepare(
        `UPDATE payments SET status = ?1, updated_at = ?2, effect = ?3, effect_done_at = NULL
         WHERE provider = ?4 AND payment_id = ?5 AND status = ?6`,
      )
      .bind(next.status, next.updatedAt, effect, previous.provider, previous.paymentId, previous.status)
      .run();
    return changesOf(result) === 1;
  }

  /** Marks the payment's effect on the booking as performed. */
  async effectDone(provider: string, paymentId: string, at: number): Promise<void> {
    await this.#db
      .prepare(`UPDATE payments SET effect_done_at = ? WHERE provider = ? AND payment_id = ? AND effect <> 'none' AND effect_done_at IS NULL`)
      .bind(at, provider, paymentId)
      .run();
  }

  /**
   * The payments that became `paid` or `cancelled` at or before `before` and whose effect was never marked done,
   * oldest first: what a scheduled run finishes. Give `before` some distance from now, or it picks up payments a
   * request is finishing at this moment.
   */
  async owedEffects(before: number, limit = 50): Promise<OwedEffect[]> {
    const result = await this.#db
      .prepare(
        `SELECT * FROM payments WHERE effect <> 'none' AND effect_done_at IS NULL AND updated_at <= ?
         ORDER BY updated_at LIMIT ?`,
      )
      .bind(before, limit)
      .all<PaymentRow>();
    return rowsOf<PaymentRow>(result).flatMap((row) => {
      const effect = oneOf(EFFECTS, row.effect, 'payments.effect');
      return effect === 'none' ? [] : [{ record: record(row), effect }];
    });
  }
}
