import { describe, expect, test } from 'bun:test';

import {
  basicAuth,
  COMGATE_STATUS,
  ComgateProvider,
  createBody,
  expirationTime,
  notificationFields,
  sameSecret,
  toEvent,
  type ComgateConfig,
  type Fetch,
} from './comgate.ts';
import { PaymentError, type CreatePaymentRequest, type PaymentErrorKind } from './provider.ts';

// Made-up credentials: the real ones are Worker secrets.
const MERCHANT = '000000';
const SECRET = 'not-a-real-secret';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** A `fetch` that answers from a queue and remembers what it was asked. */
function fakeFetch(...answers: Array<Response | Error>): { fetch: Fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, ...init });
    const answer = answers.shift();
    if (!answer) throw new Error('no answer queued');
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetch, calls };
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const provider = (fetch: Fetch, config: Partial<ComgateConfig> = {}) => new ComgateProvider({ merchant: MERCHANT, secret: SECRET, test: false, fetch, ...config });

const request: CreatePaymentRequest = {
  amount: { amount: 150000, currency: 'CZK' },
  reference: 'booking-42',
  label: 'Studio booking',
  customerEmail: 'name@example.com',
  customerName: 'Jane Doe',
  language: 'en',
  returnUrls: {
    paid: 'https://studio.example/booking/paid',
    cancelled: 'https://studio.example/booking/cancelled',
    pending: 'https://studio.example/booking/pending',
  },
};

/** A status answer as Comgate documents it: the amount and the test flag are strings. */
const status = (over: Record<string, unknown> = {}) => ({
  code: 0,
  message: 'OK',
  test: 'false',
  price: '150000',
  curr: 'CZK',
  label: 'Studio booking',
  refId: 'booking-42',
  email: 'name@example.com',
  transId: 'AB12-CD34-EF56',
  status: 'PAID',
  ...over,
});

const notification = (over: Record<string, string> = {}) => ({
  merchant: MERCHANT,
  test: 'false',
  price: '150000',
  curr: 'CZK',
  label: 'Studio booking',
  refId: 'booking-42',
  email: 'name@example.com',
  transId: 'AB12-CD34-EF56',
  secret: SECRET,
  status: 'PAID',
  ...over,
});

async function failure(promise: Promise<unknown>): Promise<PaymentError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof PaymentError) return e;
    throw e;
  }
  throw new Error('expected a PaymentError');
}

const kindOf = (fn: () => unknown): PaymentErrorKind | undefined => {
  try {
    fn();
  } catch (e) {
    if (e instanceof PaymentError) return e.kind;
    throw e;
  }
  return undefined;
};

describe('creating a payment', () => {
  test('the request is a JSON POST with Basic auth and exactly the documented fields', async () => {
    const { fetch, calls } = fakeFetch(
      json({ code: 0, message: 'OK', transId: 'AB12-CD34-EF56', redirect: 'https://pay1.comgate.cz/init?id=AB12-CD34-EF56' }, 201),
    );
    const created = await provider(fetch).createPayment(request);

    expect(created).toEqual({ paymentId: 'AB12-CD34-EF56', redirectUrl: 'https://pay1.comgate.cz/init?id=AB12-CD34-EF56' });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://payments.comgate.cz/v2.0/payment.json');
    expect(call.method).toBe('POST');
    expect(call.headers).toEqual({
      authorization: `Basic ${btoa(`${MERCHANT}:${SECRET}`)}`,
      accept: 'application/json',
      'content-type': 'application/json',
    });
    expect(call.body).toBe(
      '{"test":false,"price":150000,"curr":"CZK","label":"Studio booking","refId":"booking-42","method":"ALL",' +
        '"email":"name@example.com","fullName":"Jane Doe","lang":"en",' +
        '"url_paid":"https://studio.example/booking/paid","url_cancelled":"https://studio.example/booking/cancelled",' +
        '"url_pending":"https://studio.example/booking/pending"}',
    );
  });

  test('the secret travels in the header only', async () => {
    const { fetch, calls } = fakeFetch(json({ code: 0, message: 'OK', transId: 'T', redirect: 'https://pay1.comgate.cz/x' }, 201));
    await provider(fetch).createPayment(request);
    expect(calls[0]!.body).not.toContain(SECRET);
    expect(calls[0]!.url).not.toContain(SECRET);
  });

  test('test mode, a method, a country and an expiry are sent when set', () => {
    const body = createBody({ test: true, method: 'CARD_ALL', country: 'ALL' }, { ...request, expiresInMinutes: 30 });
    expect(body).toMatchObject({ test: true, method: 'CARD_ALL', country: 'ALL', expirationTime: '30m' });
  });

  test('an expiry is one number and one unit', () => {
    expect(expirationTime(45)).toBe('45m');
    expect(expirationTime(120)).toBe('2h');
    expect(expirationTime(90)).toBe('90m');
    expect(expirationTime(2880)).toBe('2d');
  });

  test('what Comgate would refuse is not sent', async () => {
    const config = { test: false };
    const bad: Array<Partial<CreatePaymentRequest>> = [
      { amount: { amount: 10.5, currency: 'CZK' } },
      { amount: { amount: 0, currency: 'CZK' } },
      { amount: { amount: 100, currency: 'JPY' } },
      { amount: { amount: 150, currency: 'HUF' } },
      { label: '' },
      { label: 'seventeen letters' },
      { reference: '' },
      { customerEmail: '' },
      { customerName: '' },
      { expiresInMinutes: 5 },
      { expiresInMinutes: 7 * 24 * 60 + 1 },
    ];
    for (const over of bad) expect(kindOf(() => createBody(config, { ...request, ...over }))).toBe('invalid_request');

    const { fetch, calls } = fakeFetch();
    expect((await failure(provider(fetch).createPayment({ ...request, label: '' }))).kind).toBe('invalid_request');
    expect(calls).toHaveLength(0);
  });

  test('a refusal carries Comgate’s code', async () => {
    const { fetch } = fakeFetch(json({ code: 1309, message: 'incorrect amount' }, 400));
    const error = await failure(provider(fetch).createPayment(request));
    expect(error.kind).toBe('rejected');
    expect(error.providerCode).toBe(1309);
    expect(error.httpStatus).toBe(400);
    expect(error.message).toContain('incorrect amount');
  });

  test('a refusal with a 2xx status is still a refusal', async () => {
    const { fetch } = fakeFetch(json({ code: 1301, message: 'unknown e-shop' }, 201));
    expect((await failure(provider(fetch).createPayment(request))).providerCode).toBe(1301);
  });

  test('a 4xx without a result is a refusal, anything else unreadable is a transport fault', async () => {
    const a = fakeFetch(new Response('Bad Request', { status: 400 }));
    expect((await failure(provider(a.fetch).createPayment(request))).kind).toBe('rejected');

    const b = fakeFetch(new Response('<html>', { status: 500 }));
    const error = await failure(provider(b.fetch).createPayment(request));
    expect(error.kind).toBe('transport');
    expect(error.httpStatus).toBe(500);

    const c = fakeFetch(new Response(null, { status: 204 }));
    expect((await failure(provider(c.fetch).createPayment(request))).kind).toBe('transport');

    const d = fakeFetch(new TypeError('network down'));
    expect((await failure(provider(d.fetch).createPayment(request))).kind).toBe('transport');
  });

  test('a success without an id, or with a redirect that is not https, is not trusted', async () => {
    const a = fakeFetch(json({ code: 0, message: 'OK', redirect: 'https://pay1.comgate.cz/x' }, 201));
    expect((await failure(provider(a.fetch).createPayment(request))).kind).toBe('transport');
    const b = fakeFetch(json({ code: 0, message: 'OK', transId: 'T', redirect: 'javascript:alert(1)' }, 201));
    expect((await failure(provider(b.fetch).createPayment(request))).kind).toBe('transport');
  });
});

describe('credentials', () => {
  test('Basic auth is base64 of merchant:secret, read as UTF-8', () => {
    expect(basicAuth('123', 'abc')).toBe('Basic MTIzOmFiYw==');
    expect(basicAuth('m', 'ž')).toBe('Basic bTrFvg==');
  });

  test('secrets compare by content', async () => {
    expect(await sameSecret('abc', 'abc')).toBe(true);
    expect(await sameSecret('abc', 'abd')).toBe(false);
    expect(await sameSecret('abc', '')).toBe(false);
  });
});

describe('the status of a payment', () => {
  test('is asked with a GET on the transaction', async () => {
    const { fetch, calls } = fakeFetch(json(status()));
    const event = await provider(fetch).getPayment('AB12-CD34-EF56');

    expect(calls[0]).toEqual({
      url: 'https://payments.comgate.cz/v2.0/payment/transId/AB12-CD34-EF56.json',
      method: 'GET',
      headers: { authorization: `Basic ${btoa(`${MERCHANT}:${SECRET}`)}`, accept: 'application/json' },
    });
    expect(event).toEqual({
      provider: 'comgate',
      paymentId: 'AB12-CD34-EF56',
      reference: 'booking-42',
      status: 'paid',
      amount: { amount: 150000, currency: 'CZK' },
      test: false,
    });
  });

  test('every documented state has ours', () => {
    expect(COMGATE_STATUS).toEqual({ PENDING: 'pending', AUTHORIZED: 'authorised', PAID: 'paid', CANCELLED: 'cancelled' });
    for (const [theirs, ours] of Object.entries(COMGATE_STATUS)) expect(toEvent(status({ status: theirs })).status).toBe(ours);
  });

  test('an unknown state, amount or id is not guessed at', () => {
    for (const over of [{ status: 'REFUNDED' }, { status: 'paid' }, { status: undefined }, { price: '15.5' }, { price: '' }, { curr: 'czk' }, { transId: '' }]) {
      expect(kindOf(() => toEvent(status(over)))).toBe('malformed');
    }
  });

  test('a payment is a test unless Comgate says it is not', () => {
    expect(toEvent(status({ test: 'true' })).test).toBe(true);
    expect(toEvent(status({ test: true })).test).toBe(true);
    expect(toEvent(status({ test: undefined })).test).toBe(true);
    expect(toEvent(status({ test: false })).test).toBe(false);
  });

  test('the id is escaped in the path', async () => {
    const { fetch, calls } = fakeFetch(json({ code: 1400, message: 'bad request' }, 400));
    await failure(provider(fetch).getPayment('a/b?c'));
    expect(calls[0]!.url).toBe('https://payments.comgate.cz/v2.0/payment/transId/a%2Fb%3Fc.json');
  });

  test('an answer about another payment is refused', async () => {
    const { fetch } = fakeFetch(json(status({ transId: 'ZZZZ-ZZZZ-ZZZZ' })));
    expect((await failure(provider(fetch).getPayment('AB12-CD34-EF56'))).kind).toBe('transport');
  });

  test('an error code is a refusal', async () => {
    const { fetch } = fakeFetch(json({ code: 1400, message: 'bad request' }));
    expect((await failure(provider(fetch).getPayment('AB12-CD34-EF56'))).providerCode).toBe(1400);
  });
});

describe('a notification', () => {
  const asJson = (over: Record<string, string> = {}) => ({ contentType: 'application/json', body: JSON.stringify(notification(over)) });
  const asForm = (over: Record<string, string> = {}) => ({
    contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
    body: new URLSearchParams(notification(over)).toString(),
  });

  test('reads as JSON or as a form, by content type or by its look', () => {
    expect(notificationFields(asJson())).toEqual(notification());
    expect(notificationFields(asForm())).toEqual(notification());
    expect(notificationFields({ contentType: null, body: asJson().body })).toEqual(notification());
    expect(notificationFields({ contentType: null, body: asForm().body })).toEqual(notification());
    expect(notificationFields({ contentType: 'application/json', body: '{"price":150000,"test":false}' })).toEqual({ price: '150000', test: 'false' });
  });

  test('with our credentials is confirmed by asking for the status', async () => {
    const { fetch, calls } = fakeFetch(json(status()));
    const event = await provider(fetch).parseNotification(asJson());
    expect(event).toMatchObject({ paymentId: 'AB12-CD34-EF56', reference: 'booking-42', status: 'paid', amount: { amount: 150000, currency: 'CZK' } });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET https://payments.comgate.cz/v2.0/payment/transId/AB12-CD34-EF56.json']);
  });

  test('says what Comgate says when asked, not what the notification claims', async () => {
    const { fetch } = fakeFetch(json(status({ status: 'PENDING', price: '100' })));
    const event = await provider(fetch).parseNotification(asForm({ status: 'PAID' }));
    expect(event.status).toBe('pending');
    expect(event.amount.amount).toBe(100);
  });

  test('with a wrong or missing secret, or another merchant, is refused before anything is asked', async () => {
    const { fetch, calls } = fakeFetch();
    const p = provider(fetch);
    for (const input of [asJson({ secret: 'guess' }), asForm({ secret: '' }), asJson({ merchant: '999999' }), { contentType: null, body: '' }]) {
      expect((await failure(p.parseNotification(input))).kind).toBe('unauthenticated');
    }
    const { secret: _, ...without } = notification();
    expect((await failure(p.parseNotification({ contentType: 'application/json', body: JSON.stringify(without) }))).kind).toBe('unauthenticated');
    expect(calls).toHaveLength(0);
  });

  test('that will not read is malformed', async () => {
    const { fetch } = fakeFetch();
    const p = provider(fetch);
    for (const body of ['{', '[]', 'null']) {
      expect((await failure(p.parseNotification({ contentType: 'application/json', body }))).kind).toBe('malformed');
    }
    expect((await failure(p.parseNotification(asJson({ status: 'DONE' })))).kind).toBe('malformed');
  });

  test('about a test payment does not count in production, nor a real one in test mode', async () => {
    const a = fakeFetch(json(status({ test: 'true' })));
    expect((await failure(provider(a.fetch).parseNotification(asJson({ test: 'true' })))).kind).toBe('unauthenticated');
    const b = fakeFetch(json(status()));
    expect((await failure(provider(b.fetch, { test: true }).parseNotification(asJson()))).kind).toBe('unauthenticated');
    const c = fakeFetch(json(status({ test: 'true' })));
    expect((await provider(c.fetch, { test: true }).parseNotification(asJson({ test: 'true' }))).test).toBe(true);
  });

  test('is passed on when the status cannot be asked, so that Comgate sends it again', async () => {
    const { fetch } = fakeFetch(new Response('', { status: 503 }));
    expect((await failure(provider(fetch).parseNotification(asJson()))).kind).toBe('transport');
  });

  test('can be read alone, for every state it carries', async () => {
    const { fetch, calls } = fakeFetch();
    const p = provider(fetch, { confirmNotifications: false });
    expect((await p.parseNotification(asForm({ status: 'PAID' }))).status).toBe('paid');
    expect((await p.parseNotification(asJson({ status: 'CANCELLED' }))).status).toBe('cancelled');
    expect((await p.parseNotification(asJson({ status: 'AUTHORIZED' }))).status).toBe('authorised');
    expect(calls).toHaveLength(0);
  });

  test('is acknowledged with a 2xx', () => {
    const { fetch } = fakeFetch();
    const ack = provider(fetch).notificationAck;
    expect([200, 201, 202, 204, 205]).toContain(ack.status);
    expect(JSON.parse(ack.body)).toEqual({ code: 0, message: 'OK' });
  });
});

describe('a refund', () => {
  test('posts the transaction, the amount and the mode', async () => {
    const { fetch, calls } = fakeFetch(json({ code: 0, message: 'OK' }));
    await provider(fetch).refund({ paymentId: 'AB12-CD34-EF56', amount: { amount: 150000, currency: 'CZK' } });
    expect(calls[0]!.url).toBe('https://payments.comgate.cz/v2.0/refund.json');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['content-type']).toBe('application/json');
    expect(calls[0]!.body).toBe('{"transId":"AB12-CD34-EF56","amount":150000,"test":false}');
  });

  test('of a part carries its own reference, and is a test refund in test mode', async () => {
    const { fetch, calls } = fakeFetch(json({ code: 0, message: 'OK' }));
    await provider(fetch, { test: true }).refund({ paymentId: 'T', amount: { amount: 5000, currency: 'CZK' }, reference: 'refund-7' });
    expect(calls[0]!.body).toBe('{"transId":"T","amount":5000,"test":true,"refId":"refund-7"}');
  });

  test('that Comgate refuses says why', async () => {
    const a = fakeFetch(json({ code: 1402, message: 'refund amount higher than allowed' }));
    expect((await failure(provider(a.fetch).refund({ paymentId: 'T', amount: { amount: 1, currency: 'CZK' } }))).providerCode).toBe(1402);
    const b = fakeFetch(json({ code: 1401, message: 'payment is CANCELLED' }, 400));
    expect((await failure(provider(b.fetch).refund({ paymentId: 'T', amount: { amount: 1, currency: 'CZK' } }))).providerCode).toBe(1401);
  });

  test('of nothing, or of a fraction, is not sent', async () => {
    const { fetch, calls } = fakeFetch();
    for (const amount of [0, -5, 1.5]) {
      expect((await failure(provider(fetch).refund({ paymentId: 'T', amount: { amount, currency: 'CZK' } }))).kind).toBe('invalid_request');
    }
    expect(calls).toHaveLength(0);
  });
});

describe('cancelling', () => {
  test('is a DELETE on the transaction', async () => {
    const { fetch, calls } = fakeFetch(json({ code: 0, message: 'OK' }));
    await provider(fetch).cancel('AB12-CD34-EF56');
    expect(calls[0]).toMatchObject({ url: 'https://payments.comgate.cz/v2.0/payment/transId/AB12-CD34-EF56.json', method: 'DELETE' });
    expect(calls[0]!.body).toBeUndefined();
  });

  test('a payment that is no longer pending is refused with 1400', async () => {
    const { fetch } = fakeFetch(json({ code: 1400, message: 'payment cannot be cancelled' }));
    const error = await failure(provider(fetch).cancel('AB12-CD34-EF56'));
    expect(error.kind).toBe('rejected');
    expect(error.providerCode).toBe(1400);
  });
});

describe('the base address', () => {
  test('can be replaced, with or without a trailing slash', async () => {
    const { fetch, calls } = fakeFetch(json({ code: 0, message: 'OK' }));
    await provider(fetch, { baseUrl: 'https://gateway.example/v2.0/' }).cancel('T');
    expect(calls[0]!.url).toBe('https://gateway.example/v2.0/payment/transId/T.json');
  });
});
