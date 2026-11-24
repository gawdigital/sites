// The Comgate adapter: Comgate's REST API (v2.0, JSON) behind our `PaymentProvider`.
//
// Built from Comgate's documentation as read on 2026-11-24:
//   https://apidoc.comgate.cz/en/api/rest/          (endpoints, fields, result codes)
//   https://apidoc.comgate.cz/en/api/post/          (the form-encoded v1.0 twin, for comparison)
//   https://apidoc.comgate.cz/en/push-notifikace    (the notification: fields, answer, repeats)
//   https://apidoc.comgate.cz/en/stavy-plateb       (PENDING, AUTHORIZED, PAID, CANCELLED; the last two are final)
//   https://apidoc.comgate.cz/en/zabezpeceni        (Basic auth, HTTPS, allowed IP addresses)
//   https://apidoc.comgate.cz/en/prubeh-platby      (redirect there and back)
//   https://apidoc.comgate.cz/en/applepay-a-googlepay
//
// Why REST and not the HTTP POST API: the documentation offers both with the same methods and recommends neither
// outright. REST is listed first and is what the payment-process page links to; it keeps the secret out of the
// request body (HTTP Basic, `base64(merchant:secret)`), and it uses plain HTTP verbs and JSON. A payment created
// through REST is notified as JSON, one created through v1.0 as a form: the notification reader takes both.
//
// What the documentation says and this file relies on:
// - Base `https://payments.comgate.cz/v2.0/`; JSON or XML only.
// - create:  POST   /v2.0/payment.json → 201 `{code, message, transId, redirect}`; `code` 0 is success. There is no
//            `merchant`, `secret` or `prepareOnly` in the REST body (those belong to v1.0): a REST create is always
//            the background kind, and the payer is sent to `redirect`, which must be used unmodified.
//            Required: price (minor units), curr, label (1–16 characters), refId, method, email or phone, fullName.
// - status:  GET    /v2.0/payment/transId/{transId}.json → `{code, message, status, price, curr, refId, test, …}`,
//            with `price` and `test` as strings. Among the optional fields is `method`, "payment method used"; the
//            notification lists `method` too. Neither the status answer, nor the notification, nor the page of
//            payment states has a refund field or a refunded state: PAID is final and stays PAID after a refund,
//            and the REST API has no call that lists a payment's refunds (refunds appear in the client portal's
//            statements only). So `PaymentEvent.refunded` is never set by this adapter.
// - cancel:  DELETE /v2.0/payment/transId/{transId}.json, for a PENDING payment only (1400 otherwise).
// - refund:  POST   /v2.0/refund.json `{transId, amount, test?, refId?}`, for a PAID payment, in full or in part
//            (1401: the payment is CANCELLED; 1402: more than may be returned). A test payment takes a test refund.
// - The notification is an HTTP POST to the "Result URL" set in the client portal, carrying `merchant`, `secret`,
//   `transId`, `status` (PAID, CANCELLED or AUTHORIZED), `price`, `curr`, `refId`, `test`. Any of 200, 201, 202,
//   204, 205 acknowledges it; otherwise it is sent again, up to 1,000 times. The status "should never be evaluated
//   solely based on the received notification": the status method must be asked, which is what this adapter does.
// - Apple Pay and Google Pay need no code: with method `ALL` and a card method (`CARD_CZ_COMGATE` or
//   `CARD_CZ_CSOB_2`) enabled on the shop, both buttons appear on Comgate's page.
// - `expirationTime` is a whole number with `m`, `h` or `d`, between 30 minutes and 7 days.
// - Calls are accepted only from the IP addresses allowed on the shop connection in the client portal.
//
// UNVERIFIED (the documentation read does not say; each is marked again where it matters):
// - the body of a non-2xx answer (assumed to be the same `{code, message}` JSON, with a fallback when it is not);
// - the body Comgate expects in the notification answer (the 2xx status is documented; the body is our choice);
// - whether several partial refunds may follow each other on one payment (1402 suggests a running limit);
// - whether Comgate ever notifies in an order other than the one things happened in;
// - whether a Worker's outgoing addresses can be put on the allowed-IP list at all (they are not fixed);
// - what `method` holds: the documentation's sample of a status answer shows `"ALL"` (the value sent on create),
//   so whether it becomes the method the payer chose once the payment is made is not confirmed. `ALL` is
//   therefore not reported as a method;
// - which expiry Comgate applies when `expirationTime` is left out (the bounds, 30 minutes to 7 days, are
//   documented; the default is not).
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

export const COMGATE_BASE_URL = 'https://payments.comgate.cz/v2.0';

/** The longest label Comgate takes. */
export const COMGATE_MAX_LABEL = 16;

/** The bounds of `expirationTime`, in minutes: 30 minutes to 7 days. */
export const COMGATE_MIN_EXPIRY = 30;
export const COMGATE_MAX_EXPIRY = 7 * 24 * 60;

/** Comgate's `method` for "let the payer choose": what a create sends, and not a method anybody paid with. */
const COMGATE_ANY_METHOD = 'ALL';

/** The currencies Comgate lists for `curr`. */
export const COMGATE_CURRENCIES = ['CZK', 'EUR', 'PLN', 'HUF', 'USD', 'GBP', 'RON', 'HRK', 'NOK', 'SEK'] as const;

/** Comgate's states and ours. */
export const COMGATE_STATUS: Readonly<Record<string, PaymentStatus>> = {
  PENDING: 'pending',
  AUTHORIZED: 'authorised',
  PAID: 'paid',
  CANCELLED: 'cancelled',
};

/** The part of `fetch` the adapter uses, so a test can hand in a fake. */
export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response>;

export interface ComgateConfig {
  /** The shop connection's id and password from the client portal: Worker secrets, never in the repository. */
  merchant: string;
  secret: string;
  /** Test mode: payments are created as tests, and only test notifications count. */
  test: boolean;
  fetch: Fetch;
  /** `ALL` lets the payer choose on Comgate's page, Apple Pay and Google Pay included. */
  method?: string;
  /** Limits the methods offered to a country's (`CZ` is Comgate's default, `ALL` lifts the limit). */
  country?: string;
  baseUrl?: string;
  /**
   * Whether a notification's content is confirmed by asking Comgate for the status, as its documentation demands.
   * Off only in tests of the reader itself.
   */
  confirmNotifications?: boolean;
}

interface Answer {
  httpStatus: number;
  /** The parsed JSON object, or `undefined` when the body is not one. */
  data: Record<string, unknown> | undefined;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

/** `Basic base64(merchant:secret)`, with the credentials read as UTF-8. */
export function basicAuth(merchant: string, secret: string): string {
  const bytes = new TextEncoder().encode(`${merchant}:${secret}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

/** Compares two secrets without telling, by the time taken, where they differ. */
export async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const p = new Uint8Array(x);
  const q = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < p.length; i++) diff |= p[i]! ^ q[i]!;
  return diff === 0;
}

/** Minutes as Comgate's `expirationTime`: one whole number and one unit, the largest unit that divides evenly. */
export function expirationTime(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

/** The JSON body of a create call. Throws `invalid_request` for what Comgate would refuse anyway. */
export function createBody(config: Pick<ComgateConfig, 'test' | 'method' | 'country'>, request: CreatePaymentRequest): Record<string, unknown> {
  const invalid = (what: string) => new PaymentError('invalid_request', what);
  if (!isMoney(request.amount)) throw invalid('the amount must be a positive whole number of minor units in an ISO 4217 currency');
  if (!(COMGATE_CURRENCIES as readonly string[]).includes(request.amount.currency)) throw invalid(`Comgate does not take ${request.amount.currency}`);
  // Comgate: a forint amount must end in 00.
  if (request.amount.currency === 'HUF' && request.amount.amount % 100 !== 0) throw invalid('a HUF amount must be whole forints');
  if (request.label.length < 1 || request.label.length > COMGATE_MAX_LABEL) throw invalid(`the label must be 1 to ${COMGATE_MAX_LABEL} characters`);
  if (!request.reference) throw invalid('the reference is missing');
  if (!request.customerEmail) throw invalid('the customer e-mail is missing');
  if (!request.customerName) throw invalid('the customer name is missing');
  const expiry = request.expiresInMinutes;
  if (expiry !== undefined && !(Number.isInteger(expiry) && expiry >= COMGATE_MIN_EXPIRY && expiry <= COMGATE_MAX_EXPIRY)) {
    throw invalid(`Comgate expires a payment after ${COMGATE_MIN_EXPIRY} minutes to 7 days, in whole minutes`);
  }

  return {
    test: config.test,
    price: request.amount.amount,
    curr: request.amount.currency,
    label: request.label,
    refId: request.reference,
    method: config.method ?? 'ALL',
    email: request.customerEmail,
    fullName: request.customerName,
    lang: request.language,
    ...(config.country === undefined ? {} : { country: config.country }),
    ...(expiry === undefined ? {} : { expirationTime: expirationTime(expiry) }),
    url_paid: request.returnUrls.paid,
    url_cancelled: request.returnUrls.cancelled,
    url_pending: request.returnUrls.pending,
  };
}

/** A notification's fields, whichever way they were encoded: JSON for a REST payment, a form for a v1.0 one. */
export function notificationFields(input: NotificationInput): Record<string, string> {
  const body = input.body.trim();
  const type = (input.contentType ?? '').toLowerCase();
  if (type.includes('json') || (!type.includes('urlencoded') && body.startsWith('{'))) {
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch (cause) {
      throw new PaymentError('malformed', 'the notification is not JSON', { cause });
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new PaymentError('malformed', 'the notification is not an object');
    return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, str(v)]));
  }
  return Object.fromEntries(new URLSearchParams(body));
}

/** Comgate's view of a payment (a status answer or a notification) as our event. `malformed` when it will not read. */
export function toEvent(fields: Record<string, unknown>): PaymentEvent {
  const status = COMGATE_STATUS[str(fields.status)];
  const price = str(fields.price);
  const currency = str(fields.curr);
  const test = str(fields.test);
  const paymentId = str(fields.transId);
  if (!status) throw new PaymentError('malformed', `unknown Comgate status "${str(fields.status)}"`);
  if (!/^\d{1,15}$/.test(price) || !/^[A-Z]{3}$/.test(currency)) throw new PaymentError('malformed', 'the amount will not read');
  if (!paymentId) throw new PaymentError('malformed', 'the transaction id is missing');
  // UNVERIFIED: that `method` names the method chosen once the payment is made (see the top of the file).
  const method = str(fields.method);
  // Anything but a clear "false" is a test: a payment is never taken for money by default.
  // No `refunded`: Comgate reports no refund state (see the top of the file).
  return {
    provider: 'comgate',
    paymentId,
    reference: str(fields.refId),
    status,
    amount: { amount: Number(price), currency },
    test: test !== 'false',
    ...(method && method !== COMGATE_ANY_METHOD ? { method } : {}),
  };
}

export class ComgateProvider implements PaymentProvider {
  readonly name = 'comgate';

  // Comgate documents the status (any of 200, 201, 202, 204, 205) and a `code` parameter in the answer.
  // UNVERIFIED: the exact body it wants; its own samples answer "OK" or nothing, so the body is likely ignored.
  readonly notificationAck: NotificationAck = { status: 200, contentType: 'application/json', body: '{"code":0,"message":"OK"}' };

  readonly expiryMinutes = { min: COMGATE_MIN_EXPIRY, max: COMGATE_MAX_EXPIRY };

  readonly #config: ComgateConfig;
  readonly #base: string;

  constructor(config: ComgateConfig) {
    this.#config = config;
    this.#base = (config.baseUrl ?? COMGATE_BASE_URL).replace(/\/+$/, '');
  }

  async createPayment(request: CreatePaymentRequest): Promise<CreatedPayment> {
    const data = this.#accepted(await this.#call('POST', '/payment.json', createBody(this.#config, request)));
    const paymentId = str(data.transId);
    const redirectUrl = str(data.redirect);
    // The payer is sent wherever this says: only ever to an https address.
    if (!paymentId || !redirectUrl.startsWith('https://')) throw new PaymentError('transport', 'Comgate created a payment without an id or a redirect');
    return { paymentId, redirectUrl };
  }

  async parseNotification(input: NotificationInput): Promise<PaymentEvent> {
    const fields = notificationFields(input);
    const known = fields.merchant === this.#config.merchant && (await sameSecret(fields.secret ?? '', this.#config.secret));
    if (!known) throw new PaymentError('unauthenticated', 'the notification does not carry our Comgate credentials');
    const notified = toEvent(fields);
    // The notification says which payment changed; what it changed to is Comgate's to say, when asked directly.
    const event = this.#config.confirmNotifications === false ? notified : await this.getPayment(notified.paymentId);
    if (event.test !== this.#config.test) throw new PaymentError('unauthenticated', 'a test payment and a real one are not interchangeable');
    return event;
  }

  async getPayment(paymentId: string): Promise<PaymentEvent> {
    const data = this.#accepted(await this.#call('GET', this.#payment(paymentId)));
    // The status answer is the source of truth for the status, the amount and the method; a notification's own
    // fields are used only to learn which payment to ask about.
    const event = toEvent(data);
    if (event.paymentId !== paymentId) throw new PaymentError('transport', 'Comgate answered about another payment');
    return event;
  }

  async refund(request: RefundRequest): Promise<void> {
    if (!isMoney(request.amount)) throw new PaymentError('invalid_request', 'the refund must be a positive whole number of minor units');
    // Comgate takes no currency here: the refund is in the payment's own.
    // UNVERIFIED: whether a second partial refund of the same payment is accepted.
    this.#accepted(
      await this.#call('POST', '/refund.json', {
        transId: request.paymentId,
        amount: request.amount.amount,
        test: this.#config.test,
        ...(request.reference === undefined ? {} : { refId: request.reference }),
      }),
    );
  }

  async cancel(paymentId: string): Promise<void> {
    this.#accepted(await this.#call('DELETE', this.#payment(paymentId)));
  }

  #payment(paymentId: string): string {
    if (!paymentId) throw new PaymentError('invalid_request', 'the payment id is missing');
    return `/payment/transId/${encodeURIComponent(paymentId)}.json`;
  }

  async #call(method: string, path: string, body?: Record<string, unknown>): Promise<Answer> {
    const headers: Record<string, string> = { authorization: basicAuth(this.#config.merchant, this.#config.secret), accept: 'application/json' };
    if (body) headers['content-type'] = 'application/json';
    let response: Response;
    let text: string;
    try {
      response = await this.#config.fetch(this.#base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
      text = await response.text();
    } catch (cause) {
      throw new PaymentError('transport', 'Comgate could not be reached', { cause });
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
    const object = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;
    return { httpStatus: response.status, data: object };
  }

  /** The answer's fields when Comgate said yes (`code` 0 on a 2xx); `rejected` with its code when it said no. */
  #accepted({ httpStatus, data }: Answer): Record<string, unknown> {
    const code = data && (typeof data.code === 'number' || typeof data.code === 'string') ? Number(data.code) : NaN;
    const ok = httpStatus >= 200 && httpStatus < 300;
    if (data && ok && code === 0) return data;
    // UNVERIFIED: that a 4xx answer carries `{code, message}` like a 2xx one; without it only the status is known.
    if (data && Number.isInteger(code) && code !== 0) {
      throw new PaymentError('rejected', `Comgate refused (${code}): ${str(data.message)}`, { providerCode: code, httpStatus });
    }
    if (httpStatus >= 400 && httpStatus < 500) throw new PaymentError('rejected', `Comgate refused with HTTP ${httpStatus}`, { httpStatus });
    throw new PaymentError('transport', `Comgate answered HTTP ${httpStatus} without a result`, { httpStatus });
  }
}

/** The amount a full refund returns: the payment's own. */
export const fullRefund = (paymentId: string, amount: Money, reference?: string): RefundRequest => ({ paymentId, amount, reference });
