// A payment provider that lives in memory, for tests of whatever uses payments: deterministic ids, no network, no
// clock. A test plays the customer and the gateway with `settle`, and gets the notification the gateway would send
// with `notification`.
import {
  isMoney,
  PaymentError,
  type CreatedPayment,
  type CreatePaymentRequest,
  type Money,
  type NotificationAck,
  type NotificationInput,
  type PaymentEvent,
  type PaymentProvider,
  type PaymentStatus,
  type RefundRequest,
} from './provider.ts';

export const FAKE_SECRET = 'fake-secret';

export interface FakePayment {
  paymentId: string;
  request: CreatePaymentRequest;
  status: PaymentStatus;
  /** What has been returned so far, in minor units. */
  refunded: number;
  /** How it was paid, once it was: reported in the payment's events. */
  method?: string;
}

const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ['authorised', 'paid', 'cancelled'],
  authorised: ['paid', 'cancelled'],
  paid: [],
  cancelled: [],
};

export class FakeProvider implements PaymentProvider {
  readonly name = 'fake';
  readonly notificationAck: NotificationAck = { status: 200, contentType: 'text/plain', body: 'OK' };

  /** Every payment created, by id. */
  readonly payments = new Map<string, FakePayment>();
  /** Every refund asked for and granted, in order. */
  readonly refunds: RefundRequest[] = [];

  readonly expiryMinutes?: { min: number; max: number };

  readonly #secret: string;
  readonly #test: boolean;
  #failures: PaymentError[] = [];

  /**
   * `test` marks every payment as a test one, as a gateway in test mode does. `expiryMinutes` gives the fake a
   * real gateway's bounds on a payment's expiry (Comgate: 30 minutes to 7 days), which it then enforces.
   */
  constructor({ secret = FAKE_SECRET, test = false, expiryMinutes }: { secret?: string; test?: boolean; expiryMinutes?: { min: number; max: number } } = {}) {
    this.#secret = secret;
    this.#test = test;
    if (expiryMinutes) this.expiryMinutes = expiryMinutes;
  }

  /** Makes the next call to the provider (create, query, refund, cancel) fail with this error, once. */
  failNext(error: PaymentError = new PaymentError('transport', 'the fake provider is unreachable')): void {
    this.#failures.push(error);
  }

  /**
   * Plays the gateway: moves a payment on, as the customer paying or giving up would. A payment that is paid or
   * authorised has a method from then on: `method`, or `CARD` when the test does not care.
   */
  settle(paymentId: string, status: PaymentStatus, method = 'CARD'): void {
    const payment = this.#get(paymentId);
    if (payment.status === status) return;
    if (!TRANSITIONS[payment.status].includes(status)) throw new Error(`a ${payment.status} payment cannot become ${status}`);
    payment.status = status;
    if (status !== 'cancelled') payment.method ??= method;
  }

  /** The notification the gateway would send for a payment now; `secret` forges one that must be refused. */
  notification(paymentId: string, { secret = this.#secret }: { secret?: string } = {}): NotificationInput {
    return { contentType: 'application/json', body: JSON.stringify({ ...this.#event(this.#get(paymentId)), secret }) };
  }

  async createPayment(request: CreatePaymentRequest): Promise<CreatedPayment> {
    this.#fail();
    if (!isMoney(request.amount)) throw new PaymentError('invalid_request', 'the amount must be a positive whole number of minor units');
    const expiry = request.expiresInMinutes;
    const bounds = this.expiryMinutes;
    if (expiry !== undefined && bounds && !(Number.isInteger(expiry) && expiry >= bounds.min && expiry <= bounds.max)) {
      throw new PaymentError('invalid_request', `a payment expires after ${bounds.min} to ${bounds.max} whole minutes`);
    }
    const paymentId = `fake-${this.payments.size + 1}`;
    this.payments.set(paymentId, { paymentId, request, status: 'pending', refunded: 0 });
    return { paymentId, redirectUrl: `https://pay.example/${paymentId}` };
  }

  async parseNotification(input: NotificationInput): Promise<PaymentEvent> {
    let data: Partial<PaymentEvent> & { secret?: unknown };
    try {
      data = JSON.parse(input.body);
    } catch (cause) {
      throw new PaymentError('malformed', 'the notification is not JSON', { cause });
    }
    if (typeof data !== 'object' || data === null) throw new PaymentError('malformed', 'the notification is not an object');
    if (data.secret !== this.#secret) throw new PaymentError('unauthenticated', 'the notification does not carry the secret');
    const payment = typeof data.paymentId === 'string' ? this.payments.get(data.paymentId) : undefined;
    if (!payment) throw new PaymentError('malformed', 'the notification names no known payment');
    // Like a real gateway asked for the status: the state now, not the state when the notification was written.
    return this.#event(payment);
  }

  async getPayment(paymentId: string): Promise<PaymentEvent> {
    this.#fail();
    return this.#event(this.#known(paymentId));
  }

  async refund(request: RefundRequest): Promise<void> {
    this.#fail();
    const payment = this.#known(request.paymentId);
    const paid: Money = payment.request.amount;
    if (!isMoney(request.amount)) throw new PaymentError('invalid_request', 'the refund must be a positive whole number of minor units');
    if (payment.status !== 'paid') throw new PaymentError('rejected', `a ${payment.status} payment cannot be refunded`);
    if (request.amount.currency !== paid.currency) throw new PaymentError('rejected', 'the refund is in another currency');
    if (payment.refunded + request.amount.amount > paid.amount) throw new PaymentError('rejected', 'the refund is more than was paid');
    payment.refunded += request.amount.amount;
    this.refunds.push(request);
  }

  async cancel(paymentId: string): Promise<void> {
    this.#fail();
    const payment = this.#known(paymentId);
    if (payment.status !== 'pending') throw new PaymentError('rejected', `a ${payment.status} payment cannot be cancelled`);
    payment.status = 'cancelled';
  }

  #fail(): void {
    const error = this.#failures.shift();
    if (error) throw error;
  }

  /** A payment a test names: a wrong id is the test's mistake. */
  #get(paymentId: string): FakePayment {
    const payment = this.payments.get(paymentId);
    if (!payment) throw new Error(`no fake payment ${paymentId}`);
    return payment;
  }

  /** A payment the code under test names: a wrong id is the provider saying no. */
  #known(paymentId: string): FakePayment {
    const payment = this.payments.get(paymentId);
    if (!payment) throw new PaymentError('rejected', `unknown payment ${paymentId}`);
    return payment;
  }

  #event(payment: FakePayment): PaymentEvent {
    return {
      provider: this.name,
      paymentId: payment.paymentId,
      reference: payment.request.reference,
      status: payment.status,
      amount: { ...payment.request.amount },
      test: this.#test,
      ...(payment.method === undefined ? {} : { method: payment.method }),
      // Unlike Comgate, the fake says how much it has returned, so both kinds of provider are exercised.
      refunded: payment.refunded,
    };
  }
}
