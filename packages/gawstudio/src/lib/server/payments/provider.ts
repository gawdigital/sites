// The one interface every payment gateway sits behind, so the gateway can be replaced: the booking code talks to a
// `PaymentProvider` and never to Comgate directly. Kept free of platform imports (only Web APIs), so it runs on a
// Worker and unit-tests under Bun.

/** An amount in minor units (haléře, cents) with its ISO 4217 currency: never a float. */
export interface Money {
  amount: number;
  currency: string;
}

/**
 * A payment's state, the same for every gateway. `authorised` is a card pre-authorisation: the money is blocked,
 * not taken. `paid` and `cancelled` are final.
 */
export const PAYMENT_STATUSES = ['pending', 'authorised', 'paid', 'cancelled'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const isPaymentStatus = (s: string): s is PaymentStatus => (PAYMENT_STATUSES as readonly string[]).includes(s);

/** Whether a status can still change. */
export const isFinal = (status: PaymentStatus): boolean => status === 'paid' || status === 'cancelled';

/**
 * Why a payment call failed:
 * - `invalid_request`: we asked for something the provider cannot take (caught before any request is sent);
 * - `rejected`: the provider answered and said no (`providerCode` holds its code);
 * - `transport`: no usable answer (network fault, unexpected HTTP status, unreadable body): safe to retry a query,
 *   but a create or refund may have gone through, so ask for the status first;
 * - `unauthenticated`: a notification that does not carry our credentials;
 * - `malformed`: a notification we cannot read;
 * - `wrong_mode`: a notification that is the provider's own, about a test payment where real ones are taken or a
 *   real one where the gateway is in test mode: never to be acted on, and never to be sent again either;
 * - `unsupported`: the provider has no such operation.
 */
export type PaymentErrorKind = 'invalid_request' | 'rejected' | 'transport' | 'unauthenticated' | 'malformed' | 'wrong_mode' | 'unsupported';

export class PaymentError extends Error {
  override readonly name = 'PaymentError';
  readonly kind: PaymentErrorKind;
  /** The provider's own result code, when it gave one. */
  readonly providerCode?: number;
  /** The HTTP status of the provider's answer, when there was one. */
  readonly httpStatus?: number;

  constructor(kind: PaymentErrorKind, message: string, detail: { providerCode?: number; httpStatus?: number; cause?: unknown } = {}) {
    super(message, { cause: detail.cause });
    this.kind = kind;
    this.providerCode = detail.providerCode;
    this.httpStatus = detail.httpStatus;
  }
}

export const isPaymentError = (e: unknown, kind?: PaymentErrorKind): e is PaymentError =>
  e instanceof PaymentError && (kind === undefined || e.kind === kind);

/** Where the provider sends the customer back to, by outcome. `pending` is normal (a bank transfer), not an error. */
export interface ReturnUrls {
  paid: string;
  cancelled: string;
  pending: string;
}

export interface CreatePaymentRequest {
  amount: Money;
  /** Our own id for what is paid (the booking, the order); comes back in every event. */
  reference: string;
  /** What the customer sees on the provider's page; providers limit its length. */
  label: string;
  customerEmail: string;
  customerName: string;
  /** ISO 639-1, the language of the provider's page. */
  language: string;
  returnUrls: ReturnUrls;
  /** After how many minutes the provider gives up on an unpaid payment; the provider's own default when left out. */
  expiresInMinutes?: number;
}

export interface CreatedPayment {
  /** The provider's id of the payment: store it, every later call needs it. */
  paymentId: string;
  /** Where to send the customer (HTTP 302), unmodified. */
  redirectUrl: string;
}

/** What a provider says about a payment, from a notification or from a status query. */
export interface PaymentEvent {
  provider: string;
  paymentId: string;
  reference: string;
  status: PaymentStatus;
  amount: Money;
  /** Whether this is a test payment: never to be mistaken for money. */
  test: boolean;
  /**
   * How the customer paid, in the provider's own code (Comgate: `CARD_CZ_CSOB_2`, `BANK_CZ_RB` …), where the
   * provider says. Left out while nothing was chosen or the provider does not tell.
   */
  method?: string;
  /**
   * How much of the payment has been returned so far, in minor units of its currency (0: nothing), where the
   * provider reports it. Left out when the provider does not say: Comgate's status answer and notification carry
   * no refund state at all, so with Comgate the only record of a refund is the one kept when `refund` succeeds
   * (`noteRefund`).
   */
  refunded?: number;
}

/** A server-to-server notification as received: the body unparsed, since the provider decides its encoding. */
export interface NotificationInput {
  contentType: string | null;
  body: string;
}

/** What the provider must be answered with once a notification is accepted; anything else makes it send again. */
export interface NotificationAck {
  status: number;
  contentType: string;
  body: string;
}

export interface RefundRequest {
  paymentId: string;
  /** How much to return: the payment's whole amount for a full refund, less for a partial one. */
  amount: Money;
  /** Our own id for the refund, where the provider keeps one. */
  reference?: string;
}

export interface PaymentProvider {
  /** A stable name for the gateway (`comgate`), stored with each payment. */
  readonly name: string;
  /** The answer that tells the provider a notification arrived. */
  readonly notificationAck: NotificationAck;
  /**
   * The bounds of `CreatePaymentRequest.expiresInMinutes`, where the provider has any. The lower bound matters to
   * whoever holds something while the customer pays: a payment cannot be made to run out sooner than this, so a
   * shorter hold can be outlived by its payment (see the checkout's `checkoutReport`).
   */
  readonly expiryMinutes?: { min: number; max: number };

  /** Opens a payment and says where to send the customer. */
  createPayment(request: CreatePaymentRequest): Promise<CreatedPayment>;

  /**
   * Reads a server-to-server notification and proves it is the provider's.
   * Throws `unauthenticated` or `malformed`; the caller answers those with an error status, not the ack. Throws
   * `wrong_mode` for an authentic notification about a payment of the other mode (test or real), where the
   * provider checks that: the caller acknowledges it and does nothing with it.
   */
  parseNotification(input: NotificationInput): Promise<PaymentEvent>;

  /** Asks the provider for a payment's current state. */
  getPayment(paymentId: string): Promise<PaymentEvent>;

  /** Returns money for a paid payment, wholly or in part. */
  refund(request: RefundRequest): Promise<void>;

  /** Cancels a payment that is not paid yet. Absent when the provider cannot. */
  cancel?(paymentId: string): Promise<void>;
}

/** Whether an amount is a positive whole number of minor units in a three-letter currency. */
export function isMoney(money: Money): boolean {
  return Number.isSafeInteger(money.amount) && money.amount > 0 && /^[A-Z]{3}$/.test(money.currency);
}

/** Cancels an unpaid payment where the provider can; `unsupported` where it cannot. */
export async function cancelPayment(provider: PaymentProvider, paymentId: string): Promise<void> {
  if (!provider.cancel) throw new PaymentError('unsupported', `${provider.name} cannot cancel a payment`);
  await provider.cancel(paymentId);
}
