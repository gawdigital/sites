// What the checkout keeps, what it is given and what it hands back. Plain data throughout: a `Checkout` can be
// stored as JSON, and every side effect the caller must carry out is a value in a list, never an action taken here.
import type { AuthSettings, AuthStore } from '../auth/index.ts';
import type { BookingContext, Interval, Refusal, Session, SlotKind } from '../booking/index.ts';
import type { InvoicingError, InvoicingProvider, PaymentMethod } from '../invoicing/index.ts';
import type { Catalogue, CompanyDetails, Currency, Flow, Order, OrderSettings, OrderState, Quote, QuoteLine, TrackRequest } from '../orders/index.ts';
import type { NotificationAck, PaymentOutcome, PaymentProvider, PaymentRecord, ReturnUrls } from '../payments/index.ts';
import type { CheckoutStore } from './store.ts';

/** The site's locales: the language of the provider's payment page, of the invoice and of the e-mails. */
export const LANGUAGES = ['en', 'de', 'cs'] as const;
export type Language = (typeof LANGUAGES)[number];

/** An amount in minor units in one of the studio's currencies. */
export interface Amount {
  amount: number;
  currency: Currency;
}

export interface Customer {
  /** Normalised (`normaliseEmail`). */
  email: string;
  name: string;
  language: Language;
}

/** The slot a customer picked, by its instants (epoch milliseconds); `technicianId` is `null` for "anyone". */
export interface SlotChoice extends Interval {
  technicianId: string | null;
}

/**
 * A cart as the order form sends it. One order is one kind of work: either one recording session, or mix and
 * mastering tracks, or AI-assisted tracks; a cart that mixes them is refused (see `startCheckout`).
 */
export interface CheckoutRequest {
  /**
   * The order's id, made by the caller (a random one, put into the form when it is rendered) so that the same
   * form sent twice is the same order: it is the idempotency key, the payment's reference and the hold's id.
   */
  orderId: string;
  customer: { email: string; name: string; language: Language };
  currency: Currency;
  recording?: SlotChoice;
  tracks?: readonly TrackRequest[];
  company?: CompanyDetails;
}

/** The held slot of a recording order. */
export interface HeldSlot extends SlotChoice {
  kind: SlotKind;
  /** When the hold runs out; a payment that arrives later is the "after expiry" case. */
  holdExpiresAt: number;
}

/** A step of the invoice chain, for the error report. */
export type InvoiceStep = 'customer' | 'invoice' | 'payment' | 'email';

/**
 * What a paid order still owes, step by step. Every step writes its marker when it has succeeded, so the work
 * can stop anywhere and be taken up again by the next notification or the next sweep.
 */
export interface Settlement {
  /**
   * The session of a recording order: `confirmed` from its hold, `rebooked` when the hold had run out and the
   * slot was still free, `lost` when it was not (the payment is then refunded); `none` for other orders.
   */
  booking: 'none' | 'pending' | 'confirmed' | 'rebooked' | 'lost';
  accountId?: string;
  invoiceCustomerId?: string;
  invoiceId?: string;
  invoiceUrl?: string;
  /** The payment is recorded on the invoice. */
  invoicePaid?: boolean;
  /** The invoicing provider was asked to e-mail the invoice. */
  invoiceEmailed?: boolean;
  /** The order's magic link was issued and the confirmation handed to the caller. */
  confirmed?: boolean;
  /** Why the invoice chain last stopped; cleared when it completes. */
  lastError?: { step: InvoiceStep; kind: InvoicingError['kind']; message: string; at: number };
  /** Nothing left to do. */
  done: boolean;
}

/**
 * Money to return. `pending`: the provider is still to be asked (again); `done`: returned; `manual`: the provider
 * refused or kept failing, and a person must settle it.
 */
export interface Refund {
  reason: 'slot-lost';
  /** The booking's refusal that lost the slot. */
  detail: Refusal;
  amount: Amount;
  state: 'pending' | 'done' | 'manual';
  attempts: number;
  lastError?: string;
}

/** Everything about one order's way through the checkout: the unit the store keeps. */
export interface Checkout {
  /** Counts the saves; the store refuses a save made from an older copy (see `CheckoutStore.save`). */
  version: number;
  /** The request it was made from, canonically: the same id with another cart is refused. */
  fingerprint: string;
  createdAt: number;
  order: Order;
  customer: Customer;
  quote: Quote;
  slot?: HeldSlot;
  /** The confirmed session of a recording order. */
  session?: Session;
  payment?: PaymentRecord;
  /** Where the customer pays: returned again when the form is sent again. */
  redirectUrl?: string;
  settlement?: Settlement;
  refund?: Refund;
  /** The studio alerts already raised, so a notification delivered again does not raise them again. */
  alerts: string[];
}

export type AlertProblem =
  /** A paid recording slot could not be confirmed; the payment is being refunded. */
  | 'slot-lost'
  /** The refund did not go through and will not be tried again. */
  | 'refund-failed'
  /** The provider contradicts a final status (paid after cancelled, or the reverse). */
  | 'payment-conflict'
  /** An event that is not about the order's payment as it was created (another id, amount, currency, a test payment). */
  | 'payment-mismatch'
  /** A notification for a reference no order has. */
  | 'unknown-order'
  /** The invoice's total is not what was paid. */
  | 'invoice-total-mismatch';

/** Who an e-mail is for. The studio's own address is the caller's secret (`MAIL_TO`), never data here. */
export type Recipient = { kind: 'customer'; email: string; name: string; language: Language } | { kind: 'studio' };

interface EmailOf<Template extends string, Data> {
  type: 'email';
  /** Stable per order and template: a key to de-duplicate on, should the caller's own retries need one. */
  id: string;
  to: Recipient;
  template: Template;
  data: Data;
}

/** An e-mail to send, as data: the caller words it (translations) and sends it. */
export type Email =
  | EmailOf<
      'order-confirmed',
      {
        orderId: string;
        flow: Flow;
        lines: QuoteLine[];
        total: Amount;
        session?: Session;
        /** The order's sign-in link: build its URL with `magicLinkUrl`. The token exists nowhere else. */
        link: { token: string; expiresAt: number };
        /** The invoice's public page, when the invoice was issued before this e-mail. */
        invoiceUrl?: string;
      }
    >
  | EmailOf<'payment-not-completed', { orderId: string; reason: 'cancelled' | 'expired'; slot?: Interval }>
  | EmailOf<'slot-lost', { orderId: string; slot: Interval; amount: Amount }>
  | EmailOf<'studio-new-order', { orderId: string; flow: Flow; total: Amount; customer: { name: string; email: string }; session?: Session }>
  | EmailOf<'studio-alert', { orderId?: string; problem: AlertProblem; detail: string }>;

/**
 * What the caller must do after a step. `order-paid` is the hook for what is not an e-mail: writing a recording
 * session into the calendar, starting an AI draft.
 */
export type Effect = Email | { type: 'order-paid'; id: string; orderId: string; flow: Flow; session?: Session };

export interface CheckoutSettings {
  orders: OrderSettings;
  auth: AuthSettings;
  /** Whether test payments count: only where the gateway runs in test mode. */
  acceptTestPayments: boolean;
  /** What the customer sees on the provider's page; Comgate takes 16 characters at most. */
  paymentLabel: string;
  /**
   * After how many minutes the provider gives up on an unpaid payment; the provider's default when left out. A
   * provider has bounds (`PaymentProvider.expiryMinutes`; Comgate: 30 minutes at least), and the booking holds a
   * slot for `holdMinutes` (10 by default): `checkoutReport` says what the two values mean together.
   */
  paymentExpiryMinutes?: number;
  /** The tag that marks the studio's documents in the shared invoicing account. */
  invoiceTag: string;
  /** Printed before the invoice's lines: the place to name the brand. */
  invoiceNote?: string;
  invoicePaymentMethod?: PaymentMethod;
  /** Whether the invoicing provider e-mails the invoice itself once it is paid. */
  sendInvoiceEmail: boolean;
  /** How many times a refund is tried when the provider cannot be reached, before a person is asked. */
  refundAttempts: number;
}

/** Proposed values; the label, the tag and the switch are the owner's to decide. */
export const DEFAULT_CHECKOUT_SETTINGS: Pick<CheckoutSettings, 'acceptTestPayments' | 'paymentLabel' | 'invoiceTag' | 'sendInvoiceEmail' | 'refundAttempts'> = {
  acceptTestPayments: false,
  paymentLabel: 'G.A.W.Studio',
  invoiceTag: 'gawstudio',
  sendInvoiceEmail: true,
  refundAttempts: 3,
};

/** Everything the use cases reach outside for. Nothing here reads a clock, an environment or the network itself. */
export interface CheckoutDeps {
  store: CheckoutStore;
  payments: PaymentProvider;
  invoicing: InvoicingProvider;
  auth: AuthStore;
  catalogue: Catalogue;
  settings: CheckoutSettings;
  /** Epoch milliseconds. Read once per call. */
  now: () => number;
  /** The booking settings, the shared calendar and the technicians, read fresh (see `BookingContext`). */
  booking: () => Promise<BookingContext>;
  /** Where the provider sends the customer back to. */
  returnUrls: (orderId: string, language: Language) => ReturnUrls;
  /**
   * How many units of the invoicing account's currency one unit of `currency` is worth on a day, as a decimal
   * string; `undefined` when the document needs none. Without this, an invoice in a foreign currency fails at
   * the provider and stays to be retried.
   */
  exchangeRate?: (currency: Currency, on: string) => Promise<string | undefined>;
}

export interface Problem {
  /** `invalid-…` for the request's own fields, a quote's error code for the cart. */
  code: string;
  /** Where in the request: `customer.email`, `tracks[1].addOns[0]`. */
  path: string;
}

export type StartResult =
  | { ok: true; orderId: string; redirectUrl: string; /** The order existed and its payment page is returned again. */ resumed: boolean; effects: Effect[] }
  | { ok: false; error: 'invalid'; problems: Problem[] }
  /** The slot cannot be held (any more). */
  | { ok: false; error: 'unavailable'; reason: Refusal }
  /** The id belongs to another cart. */
  | { ok: false; error: 'order-exists' }
  /**
   * The order is past paying (paid, cancelled …): send the customer to the order instead. `state` is still
   * `awaiting-payment` for the one order that was paid and lost its slot, while its refund is not through.
   */
  | { ok: false; error: 'not-awaiting-payment'; state: OrderState }
  /** The provider did not open a payment. The order stays, so sending the form again tries again. */
  | { ok: false; error: 'payment-unavailable'; retryable: boolean }
  /** Another request is working on this order right now. */
  | { ok: false; error: 'busy' };

export type NotificationResult =
  | {
      ok: true;
      /** Answer the provider with this: the event is stored, and what is left is ours to retry. */
      acknowledge: NotificationAck;
      orderId?: string;
      outcome: PaymentOutcome | 'unknown-order';
      state?: OrderState;
      /** Work is left for the next notification or sweep (an invoice that failed, a refund to retry). */
      unfinished: boolean;
      effects: Effect[];
    }
  /** Do not acknowledge: answer with `status`, and the provider sends the notification again. */
  | { ok: false; error: 'unauthenticated' | 'malformed' | 'provider-unavailable' | 'busy'; status: number; effects: Effect[] };

export interface Unsettled {
  orderId: string;
  /** What is stuck: the invoice chain or the confirmation of a paid order, or a refund. */
  what: 'settlement' | 'refund';
  /** `manual` for a refund a person must make. */
  state: 'pending' | 'manual';
  error?: string;
}

export interface SweepResult {
  /** The holds that ran out and were cleared. */
  expiredHolds: string[];
  /** The orders cancelled because their hold ran out unpaid. */
  cancelled: string[];
  /** Paid orders with work still left after this sweep, and refunds not made. */
  unsettled: Unsettled[];
  /** Orders sitting in a state past its deadline, the longest overdue first: for the admin. */
  overdue: Order[];
  /** Orders left alone because another request was working on them. */
  skipped: string[];
  effects: Effect[];
}
