import { describe, expect, test } from 'bun:test';

import { createFakturoid, retryAfter } from './fakturoid.ts';
import { basicAuth, createTokenSource, MemoryTokenCache, RENEW_MARGIN_SECONDS, TOKEN_CACHE_KEY } from './token.ts';
import type { CorrectionInput, InvoiceCustomer, InvoiceInput } from './types.ts';

const API = 'https://app.fakturoid.cz/api/v3';
const ACCOUNT = `${API}/accounts/acme`;
const USER_AGENT = 'TestApp (name@example.com)';

interface Sent {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = (sent: Sent) => Response | undefined;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/** A `fetch` that records what it is sent and answers from the first reply that has an answer. */
function fakeFetch(...replies: Reply[]) {
  const sent: Sent[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request: Sent = {
      method: init?.method ?? 'GET',
      url: String(input),
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    sent.push(request);
    for (const reply of replies) {
      const response = reply(request);
      if (response) return response;
    }
    return json({ error: 'not_found', error_description: `No reply for ${request.method} ${request.url}` }, 404);
  }) as typeof fetch;
  return { fetcher, sent, to: (path: string) => sent.filter((each) => each.url.startsWith(ACCOUNT + path)) };
}

/** Answers `method path` (the path after the account, query ignored) with each response in turn, the last one repeating. */
function on(method: string, path: string, ...responses: Array<() => Response>): Reply {
  let calls = 0;
  return (sent) => {
    if (sent.method !== method || new URL(sent.url).pathname !== new URL(ACCOUNT + path).pathname) return undefined;
    const response = responses[Math.min(calls++, responses.length - 1)];
    return response?.();
  };
}

/** The token endpoint, handing out `token-1`, `token-2`, … */
function tokenEndpoint(expiresIn = 7200): Reply {
  let issued = 0;
  return (sent) => (sent.url === `${API}/oauth/token` ? json({ access_token: `token-${++issued}`, token_type: 'Bearer', expires_in: expiresIn }) : undefined);
}

function setup(...replies: Reply[]) {
  const clock = { now: Date.UTC(2026, 10, 24, 12) };
  const now = () => clock.now;
  const cache = new MemoryTokenCache(now);
  const http = fakeFetch(tokenEndpoint(), ...replies);
  const config = { fetch: http.fetcher, clientId: 'client-id', clientSecret: 'client-secret', userAgent: USER_AGENT, cache, now, slug: 'acme' };
  return { ...http, clock, cache, config, provider: createFakturoid(config), tokenRequests: () => http.sent.filter((each) => each.url.endsWith('/oauth/token')) };
}

/** An invoice as Fakturoid returns it, cut down to what the adapter reads. */
const wireInvoice = (overrides: Record<string, unknown> = {}) => ({
  id: 529,
  custom_id: 'ORD-1',
  document_type: 'invoice',
  correction_id: null,
  number: '2026-0024',
  subject_id: 16,
  status: 'open',
  currency: 'CZK',
  total: '4840.0',
  public_html_url: 'https://app.fakturoid.cz/acme/p/69UqMuxhiA/2026-0024',
  ...overrides,
});

const consumer: InvoiceCustomer = {
  reference: 'cust-7',
  name: 'Jane Doe',
  email: 'name@example.com',
  address: { street: 'Main Street 1', city: 'Prague', zip: '11000', country: 'CZ' },
};

const company: InvoiceCustomer = {
  ...consumer,
  reference: 'cust-7-co',
  company: { name: 'Example Records s.r.o.', companyId: '12345678', vatId: 'CZ12345678' },
};

const order: InvoiceInput = {
  orderReference: 'ORD-1',
  customerId: '16',
  currency: 'CZK',
  priceMode: 'gross',
  language: 'cs',
  tag: 'gawstudio',
  issuedOn: '2026-11-24',
  paymentMethod: 'card',
  note: 'G.A.W.Studio: recording session',
  lines: [
    { name: 'G.A.W.Studio: recording session', quantity: 2, unit: 'h', unitPrice: 150000, vatRate: 21 },
    { name: 'G.A.W.Studio: extra track', quantity: 1, unitPrice: 200000, vatRate: 21 },
    { name: 'G.A.W.Studio: discount', quantity: 1, unitPrice: -16000, vatRate: 21 },
  ],
};

describe('the access token', () => {
  test('is asked for with the client credentials as Basic auth, a JSON grant and the User-Agent', async () => {
    const { config, tokenRequests } = setup();
    const result = await createTokenSource(config).token();

    expect(result).toEqual({ ok: true, value: 'token-1' });
    expect(tokenRequests()).toEqual([
      {
        method: 'POST',
        url: `${API}/oauth/token`,
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Basic ${btoa('client-id:client-secret')}`,
        },
        body: { grant_type: 'client_credentials' },
      },
    ]);
  });

  test('Basic credentials are the Base64 of id:secret', () => {
    expect(basicAuth('client_id', 'client_secret')).toBe('Basic Y2xpZW50X2lkOmNsaWVudF9zZWNyZXQ=');
  });

  test('is cached, and reused until shortly before it expires', async () => {
    const { config, clock, cache, tokenRequests } = setup();
    const tokens = createTokenSource(config);

    await tokens.token();
    expect(await cache.get(TOKEN_CACHE_KEY)).toBe('token-1');

    clock.now += (7200 - RENEW_MARGIN_SECONDS - 1) * 1000;
    expect(await tokens.token()).toEqual({ ok: true, value: 'token-1' });
    expect(tokenRequests()).toHaveLength(1);
  });

  test('is renewed before Fakturoid would let it lapse', async () => {
    const { config, clock, tokenRequests } = setup();
    const tokens = createTokenSource(config);

    await tokens.token();
    clock.now += (7200 - RENEW_MARGIN_SECONDS) * 1000;
    expect(await tokens.token()).toEqual({ ok: true, value: 'token-2' });
    expect(tokenRequests()).toHaveLength(2);
  });

  test('a token another isolate cached is used without a request', async () => {
    const { config, cache, clock, tokenRequests } = setup();
    await cache.set(TOKEN_CACHE_KEY, 'shared', clock.now + 60_000);

    expect(await createTokenSource(config).token()).toEqual({ ok: true, value: 'shared' });
    expect(tokenRequests()).toHaveLength(0);
  });

  test('simultaneous requests share one token request', async () => {
    const { config, tokenRequests } = setup();
    const tokens = createTokenSource(config);

    const [a, b] = await Promise.all([tokens.token(), tokens.token()]);
    expect(a).toEqual(b);
    expect(tokenRequests()).toHaveLength(1);
  });

  test('refused credentials are an unauthorized error with the description', async () => {
    const http = fakeFetch(() => json({ error: 'invalid_client', error_description: 'Client authentication failed' }, 401));
    const now = () => 0;
    const tokens = createTokenSource({ fetch: http.fetcher, clientId: 'a', clientSecret: 'b', userAgent: USER_AGENT, cache: new MemoryTokenCache(now), now });

    expect(await tokens.token()).toEqual({ ok: false, error: { kind: 'unauthorized', message: 'Client authentication failed' } });
  });

  test('an unreachable token endpoint is an unavailable error', async () => {
    const now = () => 0;
    const fetcher = (async () => {
      throw new TypeError('network');
    }) as unknown as typeof fetch;
    const tokens = createTokenSource({ fetch: fetcher, clientId: 'a', clientSecret: 'b', userAgent: USER_AGENT, cache: new MemoryTokenCache(now), now });

    expect((await tokens.token()).ok).toBe(false);
  });
});

describe('an API call', () => {
  test('carries the bearer token, the User-Agent and the account in its path', async () => {
    const { provider, to } = setup(on('GET', '/invoices/529.json', () => json(wireInvoice())));
    await provider.getInvoice('529');

    expect(to('/invoices/529.json')).toEqual([
      { method: 'GET', url: `${ACCOUNT}/invoices/529.json`, headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', Authorization: 'Bearer token-1' }, body: undefined },
    ]);
  });

  test('is retried once with a new token after a 401', async () => {
    const { provider, to, tokenRequests, cache } = setup(
      on(
        'GET',
        '/invoices/529.json',
        () => json({ error: 'invalid_token', error_description: 'The access token expired' }, 401),
        () => json(wireInvoice()),
      ),
    );
    const result = await provider.getInvoice('529');

    expect(result.ok).toBe(true);
    expect(to('/invoices/529.json').map((each) => each.headers.Authorization)).toEqual(['Bearer token-1', 'Bearer token-2']);
    expect(tokenRequests()).toHaveLength(2);
    expect(await cache.get(TOKEN_CACHE_KEY)).toBe('token-2');
  });

  test('gives up as unauthorized when the new token is refused too', async () => {
    const { provider, to } = setup(on('GET', '/invoices/529.json', () => json({ error: 'invalid_token', error_description: 'Nope' }, 401)));

    expect(await provider.getInvoice('529')).toEqual({ ok: false, error: { kind: 'unauthorized', message: 'Nope' } });
    expect(to('/invoices/529.json')).toHaveLength(2);
  });
});

describe('finding or creating the customer', () => {
  test('a new consumer is looked up by our reference, then created', async () => {
    const { provider, to } = setup(
      on('GET', '/subjects.json', () => json([])),
      on('POST', '/subjects.json', () => json({ id: 41, custom_id: 'cust-7' }, 201)),
    );
    const result = await provider.ensureCustomer(consumer);

    expect(result).toEqual({ ok: true, value: { id: '41', reference: 'cust-7', created: true } });
    const [lookup, creation] = to('/subjects');
    expect(lookup?.url).toBe(`${ACCOUNT}/subjects.json?custom_id=cust-7&page=1`);
    expect(creation?.method).toBe('POST');
    expect(creation?.headers['Content-Type']).toBe('application/json');
    expect(creation?.body).toEqual({
      custom_id: 'cust-7',
      name: 'Jane Doe',
      email: 'name@example.com',
      street: 'Main Street 1',
      city: 'Prague',
      zip: '11000',
      country: 'CZ',
    });
  });

  test('a company is created under its name, with the person as contact and its company and VAT IDs', async () => {
    const { provider, to } = setup(
      on('GET', '/subjects.json', () => json([])),
      on('POST', '/subjects.json', () => json({ id: 42 }, 201)),
    );
    await provider.ensureCustomer(company);

    expect(to('/subjects')[1]?.body).toEqual({
      custom_id: 'cust-7-co',
      name: 'Example Records s.r.o.',
      full_name: 'Jane Doe',
      email: 'name@example.com',
      registration_no: '12345678',
      vat_no: 'CZ12345678',
      street: 'Main Street 1',
      city: 'Prague',
      zip: '11000',
      country: 'CZ',
    });
  });

  test('an existing, unchanged customer is returned without a write', async () => {
    const stored = { id: 16, custom_id: 'cust-7', name: 'Jane Doe', email: 'name@example.com', street: 'Main Street 1', city: 'Prague', zip: '11000', country: 'CZ' };
    const { provider, sent } = setup(on('GET', '/subjects.json', () => json([stored])));

    expect(await provider.ensureCustomer(consumer)).toEqual({ ok: true, value: { id: '16', reference: 'cust-7', created: false } });
    expect(sent.filter((each) => each.method !== 'GET' && !each.url.endsWith('/oauth/token'))).toEqual([]);
  });

  test('an existing customer whose details changed gets only the changes', async () => {
    const stored = { id: 16, custom_id: 'cust-7', name: 'Jane Doe', email: 'name@example.com', street: 'Old Street 9', city: 'Prague', zip: null, country: 'CZ' };
    const { provider, to } = setup(
      on('GET', '/subjects.json', () => json([stored])),
      on('PATCH', '/subjects/16.json', () => json({ ...stored, street: 'Main Street 1', zip: '11000' })),
    );
    const result = await provider.ensureCustomer(consumer);

    expect(result).toEqual({ ok: true, value: { id: '16', reference: 'cust-7', created: false } });
    const update = to('/subjects/16.json')[0];
    expect(update?.method).toBe('PATCH');
    expect(update?.body).toEqual({ street: 'Main Street 1', zip: '11000' });
  });

  test('a record with another custom_id is not taken for the customer', async () => {
    const { provider, to } = setup(
      on('GET', '/subjects.json', () => json([{ id: 9, custom_id: 'cust-70' }])),
      on('POST', '/subjects.json', () => json({ id: 41 }, 201)),
    );

    expect(await provider.ensureCustomer(consumer)).toEqual({ ok: true, value: { id: '41', reference: 'cust-7', created: true } });
    expect(to('/subjects').map((each) => each.method)).toEqual(['GET', 'POST']);
  });

  test('a full page without the reference is followed by the next page', async () => {
    const others = Array.from({ length: 40 }, (_, i) => ({ id: 100 + i, custom_id: `other-${i}` }));
    const { provider, to } = setup(
      on(
        'GET',
        '/subjects.json',
        () => json(others),
        () => json([{ id: 16, custom_id: 'cust-7', name: 'Jane Doe', email: 'name@example.com', street: 'Main Street 1', city: 'Prague', zip: '11000', country: 'CZ' }]),
      ),
    );

    expect(await provider.ensureCustomer(consumer)).toEqual({ ok: true, value: { id: '16', reference: 'cust-7', created: false } });
    expect(to('/subjects.json').map((each) => new URL(each.url).searchParams.get('page'))).toEqual(['1', '2']);
  });
});

describe('creating the invoice', () => {
  test('a consumer order in CZK with gross prices: the exact payload', async () => {
    const { provider, to } = setup(
      on('GET', '/invoices.json', () => json([])),
      on('POST', '/invoices.json', () => json(wireInvoice(), 201)),
    );
    const result = await provider.createInvoice(order);

    const [lookup, creation] = to('/invoices.json');
    expect(lookup?.url).toBe(`${ACCOUNT}/invoices.json?custom_id=ORD-1&page=1`);
    expect(creation?.method).toBe('POST');
    expect(creation?.body).toEqual({
      custom_id: 'ORD-1',
      order_number: 'ORD-1',
      document_type: 'invoice',
      subject_id: 16,
      issued_on: '2026-11-24',
      currency: 'CZK',
      language: 'cz',
      vat_price_mode: 'from_total_with_vat',
      tags: ['gawstudio'],
      payment_method: 'card',
      note: 'G.A.W.Studio: recording session',
      lines: [
        { name: 'G.A.W.Studio: recording session', quantity: '2', unit_name: 'h', unit_price: '1500.00', vat_rate: 21 },
        { name: 'G.A.W.Studio: extra track', quantity: '1', unit_price: '2000.00', vat_rate: 21 },
        { name: 'G.A.W.Studio: discount', quantity: '1', unit_price: '-160.00', vat_rate: 21 },
      ],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        created: true,
        document: {
          id: '529',
          kind: 'invoice',
          number: '2026-0024',
          reference: 'ORD-1',
          paid: false,
          total: { amount: 484000, currency: 'CZK' },
          publicUrl: 'https://app.fakturoid.cz/acme/p/69UqMuxhiA/2026-0024',
        },
      },
    });
  });

  test('a company order in EUR with net prices: the exact payload, with the exchange rate', async () => {
    const { provider, to } = setup(
      on('GET', '/invoices.json', () => json([])),
      on('POST', '/invoices.json', () => json(wireInvoice({ id: 530, custom_id: 'ORD-2', currency: 'EUR', total: '242.0' }), 201)),
    );
    const result = await provider.createInvoice({
      orderReference: 'ORD-2',
      customerId: '42',
      currency: 'EUR',
      priceMode: 'net',
      language: 'de',
      tag: 'gawstudio',
      issuedOn: '2026-11-24',
      taxableSupplyOn: '2026-11-20',
      exchangeRate: '25.215',
      footerNote: 'G.A.W.Studio is a brand of G.A.W. Group',
      lines: [{ name: 'G.A.W.Studio: mixing', quantity: 1.5, unit: 'h', unitPrice: 13333, vatRate: 21 }],
    });

    expect(to('/invoices.json')[1]?.body).toEqual({
      custom_id: 'ORD-2',
      order_number: 'ORD-2',
      document_type: 'invoice',
      subject_id: 42,
      issued_on: '2026-11-24',
      taxable_fulfillment_due: '2026-11-20',
      currency: 'EUR',
      exchange_rate: '25.215',
      language: 'de',
      vat_price_mode: 'without_vat',
      tags: ['gawstudio'],
      footer_note: 'G.A.W.Studio is a brand of G.A.W. Group',
      lines: [{ name: 'G.A.W.Studio: mixing', quantity: '1.5', unit_name: 'h', unit_price: '133.33', vat_rate: 21 }],
    });
    expect(result.ok && result.value.document.total).toEqual({ amount: 24200, currency: 'EUR' });
  });

  test('the tag is on every invoice, and no number format is chosen: the default series', async () => {
    const { provider, to } = setup(
      on('GET', '/invoices.json', () => json([])),
      on('POST', '/invoices.json', () => json(wireInvoice(), 201)),
    );
    await provider.createInvoice({ ...order, tag: 'studio' });

    const body = to('/invoices.json')[1]?.body as Record<string, unknown>;
    expect(body.tags).toEqual(['studio']);
    expect(body).not.toHaveProperty('number_format_id');
    expect(body).not.toHaveProperty('number');
  });

  test('an order that already has an invoice gets that one back, and nothing is created', async () => {
    const { provider, to } = setup(on('GET', '/invoices.json', () => json([wireInvoice({ status: 'paid' })])));
    const result = await provider.createInvoice(order);

    expect(result.ok && result.value.created).toBe(false);
    expect(result.ok && result.value.document).toMatchObject({ id: '529', reference: 'ORD-1', paid: true });
    expect(to('/invoices.json').map((each) => each.method)).toEqual(['GET']);
  });

  test("a correction carrying the order's reference is not mistaken for its invoice", async () => {
    const { provider, to } = setup(
      on('GET', '/invoices.json', () => json([wireInvoice({ id: 600, document_type: 'correction' })])),
      on('POST', '/invoices.json', () => json(wireInvoice(), 201)),
    );
    const result = await provider.createInvoice(order);

    expect(result.ok && result.value.created).toBe(true);
    expect(to('/invoices.json').map((each) => each.method)).toEqual(['GET', 'POST']);
  });

  test('findInvoice returns the invoice of an order reference, or nothing', async () => {
    const { provider } = setup(on('GET', '/invoices.json', () => json([wireInvoice()]), () => json([])));

    expect(await provider.findInvoice('ORD-1')).toMatchObject({ ok: true, value: { id: '529' } });
    expect(await provider.findInvoice('ORD-1')).toEqual({ ok: true, value: undefined });
  });

  test('a foreign-currency invoice without an exchange rate is refused before any request', async () => {
    const { provider, sent } = setup();
    const result = await provider.createInvoice({ ...order, currency: 'EUR' });

    expect(result).toMatchObject({ ok: false, error: { kind: 'validation', fields: { exchange_rate: ['is required for a document in EUR'] } } });
    expect(sent).toEqual([]);
  });

  test('an invoice without lines, or with a fractional minor unit, is refused before any request', async () => {
    const { provider, sent } = setup();

    expect(await provider.createInvoice({ ...order, lines: [] })).toMatchObject({ ok: false, error: { kind: 'validation' } });
    expect(await provider.createInvoice({ ...order, lines: [{ name: 'x', quantity: 1, unitPrice: 10.5, vatRate: 21 }] })).toMatchObject({
      ok: false,
      error: { kind: 'validation', fields: { unit_price: ['must be an integer of minor units'] } },
    });
    expect(sent).toEqual([]);
  });
});

describe('recording the payment', () => {
  test('posts the date and the amount to the invoice', async () => {
    const { provider, to } = setup(
      on('GET', '/invoices/529.json', () => json(wireInvoice())),
      on('POST', '/invoices/529/payments.json', () => json({ id: 2, paid_on: '2026-11-24', amount: '4840.0' }, 201)),
    );
    const result = await provider.recordPayment('529', { paidOn: '2026-11-24', amount: { amount: 484000, currency: 'CZK' } });

    expect(result).toEqual({ ok: true, value: { invoiceId: '529', alreadyPaid: false } });
    const payment = to('/invoices/529/payments.json')[0];
    expect(payment?.method).toBe('POST');
    expect(payment?.body).toEqual({ paid_on: '2026-11-24', amount: '4840.00' });
  });

  test('the thank-you e-mail travels with mark_document_as_paid', async () => {
    const { provider, to } = setup(
      on('GET', '/invoices/529.json', () => json(wireInvoice())),
      on('POST', '/invoices/529/payments.json', () => json({ id: 2 }, 201)),
    );
    await provider.recordPayment('529', { paidOn: '2026-11-24', amount: { amount: 484000, currency: 'CZK' }, sendThankYouEmail: true });

    expect(to('/invoices/529/payments.json')[0]?.body).toEqual({
      paid_on: '2026-11-24',
      amount: '4840.00',
      send_thank_you_email: true,
      mark_document_as_paid: true,
    });
  });

  test('an invoice that is already paid is left alone', async () => {
    const { provider, to } = setup(on('GET', '/invoices/529.json', () => json(wireInvoice({ status: 'paid' }))));
    const result = await provider.recordPayment('529', { paidOn: '2026-11-24', amount: { amount: 484000, currency: 'CZK' } });

    expect(result).toEqual({ ok: true, value: { invoiceId: '529', alreadyPaid: true } });
    expect(to('/invoices/529/payments.json')).toEqual([]);
  });

  test("a payment in another currency than the invoice's is refused", async () => {
    const { provider, to } = setup(on('GET', '/invoices/529.json', () => json(wireInvoice())));
    const result = await provider.recordPayment('529', { paidOn: '2026-11-24', amount: { amount: 20000, currency: 'EUR' } });

    expect(result).toMatchObject({ ok: false, error: { kind: 'validation', fields: { currency: ['the invoice is in CZK'] } } });
    expect(to('/invoices/529/payments.json')).toEqual([]);
  });
});

describe('the e-mail, the public page and the PDF', () => {
  test('the invoice e-mail is an empty message, left to the account’s defaults', async () => {
    const { provider, to } = setup(on('POST', '/invoices/529/message.json', () => new Response(null, { status: 204 })));

    expect(await provider.sendInvoiceEmail('529')).toEqual({ ok: true, value: undefined });
    const message = to('/invoices/529/message.json')[0];
    expect(message?.method).toBe('POST');
    expect(message?.body).toEqual({});
  });

  test('an account that may not send e-mail is a forbidden error with Fakturoid’s code', async () => {
    const { provider } = setup(
      on('POST', '/invoices/529/message.json', () => json({ error: 'upgrade_required', error_description: 'Email delivery is only available for paid plans' }, 403)),
    );

    expect(await provider.sendInvoiceEmail('529')).toEqual({
      ok: false,
      error: { kind: 'forbidden', message: 'Email delivery is only available for paid plans', code: 'upgrade_required' },
    });
  });

  test('the invoice carries its public URL', async () => {
    const { provider } = setup(on('GET', '/invoices/529.json', () => json(wireInvoice())));
    const result = await provider.getInvoice('529');

    expect(result.ok && result.value.publicUrl).toBe('https://app.fakturoid.cz/acme/p/69UqMuxhiA/2026-0024');
  });

  test('the PDF is downloaded as bytes', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const { provider, to } = setup(on('GET', '/invoices/529/download.pdf', () => new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } })));
    const result = await provider.downloadPdf('529');

    expect(result).toEqual({ ok: true, value: pdf });
    expect(to('/invoices/529/download.pdf')[0]?.headers.Accept).toBe('application/pdf');
  });

  test('a PDF that is not generated yet (204) is not_ready', async () => {
    const { provider } = setup(on('GET', '/invoices/529/download.pdf', () => new Response(null, { status: 204 })));

    expect(await provider.downloadPdf('529')).toEqual({ ok: false, error: { kind: 'not_ready', message: 'The PDF is not generated yet.' } });
  });

  test('an ID that is not a number never reaches a URL', async () => {
    const { provider, sent } = setup();

    expect(await provider.getInvoice('../subjects/1')).toMatchObject({ ok: false, error: { kind: 'not_found' } });
    expect(await provider.downloadPdf('1/../2')).toMatchObject({ ok: false, error: { kind: 'not_found' } });
    expect(sent).toEqual([]);
  });
});

describe('the corrective document', () => {
  const refund: CorrectionInput = {
    refundReference: 'REF-1',
    invoiceId: '529',
    currency: 'CZK',
    priceMode: 'gross',
    language: 'cs',
    tag: 'gawstudio',
    issuedOn: '2026-12-01',
    note: 'G.A.W.Studio: refund of order ORD-1',
    lines: [{ name: 'G.A.W.Studio: recording session', quantity: 2, unit: 'h', unitPrice: 150000, vatRate: 21 }],
  };

  const wireCorrection = wireInvoice({ id: 600, custom_id: 'REF-1', document_type: 'correction', correction_id: 529, number: '2026-0025', total: '-3000.0' });

  test('is an invoice of type correction pointing at the invoice, to the same subject, with negated prices', async () => {
    const { provider, to } = setup(
      on('GET', '/invoices.json', () => json([])),
      on('GET', '/invoices/529.json', () => json(wireInvoice())),
      on('POST', '/invoices.json', () => json(wireCorrection, 201)),
    );
    const result = await provider.issueCorrection(refund);

    expect(to('/invoices.json')[0]?.url).toBe(`${ACCOUNT}/invoices.json?custom_id=REF-1&page=1`);
    expect(to('/invoices.json')[1]?.body).toEqual({
      custom_id: 'REF-1',
      document_type: 'correction',
      correction_id: 529,
      subject_id: 16,
      issued_on: '2026-12-01',
      currency: 'CZK',
      language: 'cz',
      vat_price_mode: 'from_total_with_vat',
      tags: ['gawstudio'],
      note: 'G.A.W.Studio: refund of order ORD-1',
      lines: [{ name: 'G.A.W.Studio: recording session', quantity: '2', unit_name: 'h', unit_price: '-1500.00', vat_rate: 21 }],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        created: true,
        document: {
          id: '600',
          kind: 'correction',
          number: '2026-0025',
          reference: 'REF-1',
          paid: false,
          total: { amount: -300000, currency: 'CZK' },
          publicUrl: 'https://app.fakturoid.cz/acme/p/69UqMuxhiA/2026-0024',
          correctsInvoiceId: '529',
        },
      },
    });
  });

  test('a refund that already has one gets it back', async () => {
    const { provider, sent } = setup(on('GET', '/invoices.json', () => json([wireCorrection])));
    const result = await provider.issueCorrection(refund);

    expect(result.ok && result.value).toMatchObject({ created: false, document: { id: '600', correctsInvoiceId: '529' } });
    expect(sent.filter((each) => each.method === 'POST' && each.url.startsWith(ACCOUNT))).toEqual([]);
  });

  test("a correction in another currency than the invoice's is refused", async () => {
    const { provider } = setup(
      on('GET', '/invoices.json', () => json([])),
      on('GET', '/invoices/529.json', () => json(wireInvoice({ currency: 'EUR' }))),
    );

    expect(await provider.issueCorrection(refund)).toMatchObject({ ok: false, error: { kind: 'validation', fields: { currency: ['the invoice is in EUR'] } } });
  });

  test('a correction of an invoice that does not exist is not_found', async () => {
    const { provider } = setup(on('GET', '/invoices.json', () => json([])));

    expect(await provider.issueCorrection(refund)).toMatchObject({ ok: false, error: { kind: 'not_found' } });
  });
});

describe('errors', () => {
  const creating = (response: () => Response) =>
    setup(
      on('GET', '/invoices.json', () => json([])),
      on('POST', '/invoices.json', response),
    ).provider.createInvoice(order);

  test('422 is a validation error with the fields Fakturoid names', async () => {
    const result = await creating(() => json({ errors: { subject_id: ["can't be blank", 'Contact does not exist.'], client_name: ["can't be blank"] } }, 422));

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'validation',
        message: "subject_id: can't be blank, Contact does not exist.; client_name: can't be blank",
        fields: { subject_id: ["can't be blank", 'Contact does not exist.'], client_name: ["can't be blank"] },
      },
    });
  });

  test('429 is a rate-limit error with the seconds until the reset', async () => {
    const result = await creating(() =>
      json({ error: 'too_many_requests', error_description: 'Slow down' }, 429, { 'X-RateLimit-Policy': 'default;q=400;w=60', 'X-RateLimit': 'default;r=0;t=55' }),
    );

    expect(result).toEqual({ ok: false, error: { kind: 'rate_limited', message: 'Slow down', retryAfterSeconds: 55 } });
  });

  test('the reset time is read from the X-RateLimit header only', () => {
    expect(retryAfter(new Headers({ 'X-RateLimit': 'default;r=398;t=7' }))).toBe(7);
    expect(retryAfter(new Headers())).toBeUndefined();
  });

  test('403 without a bank account is forbidden, with the field message', async () => {
    const result = await creating(() => json({ errors: { bank_account: ['Please set up a bank account.'] } }, 403));

    expect(result).toEqual({ ok: false, error: { kind: 'forbidden', message: 'bank_account: Please set up a bank account.', code: undefined } });
  });

  test('402 is forbidden: the account is blocked', async () => {
    expect(await creating(() => json({}, 402))).toMatchObject({ ok: false, error: { kind: 'forbidden', code: 'account_blocked' } });
  });

  test('503 and an unreachable server are unavailable', async () => {
    expect(await creating(() => json({ error: 'maintenance', error_description: 'Back soon' }, 503))).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: 'Back soon', status: 503 },
    });

    const { provider } = setup(() => {
      throw new TypeError('network');
    });
    // The token endpoint answers first in `setup`, so only the API call itself fails here.
    expect(await provider.getInvoice('529')).toEqual({ ok: false, error: { kind: 'unavailable', message: 'Fakturoid could not be reached.' } });
  });

  test('a body that is not JSON is still an error of the right kind', async () => {
    expect(await creating(() => new Response('<html>Bad gateway</html>', { status: 502 }))).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: 'Fakturoid answered 502.', status: 502 },
    });
  });

  test('an invoice we cannot read is unexpected, not a half-filled document', async () => {
    expect(await creating(() => json({ id: 1 }, 201))).toMatchObject({ ok: false, error: { kind: 'unexpected' } });
  });
});
