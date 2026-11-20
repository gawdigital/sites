import { describe, expect, test } from 'bun:test';

import { answer, contactEndpoint, contactRedirect } from './endpoint.ts';
import { readSender, type Sender } from './form.ts';

const SOURCES = ['contact'] as const;

// A site without secrets: the endpoint must answer, and must not send anything.
const POST = contactEndpoint<Sender<'contact'>>({
  sources: SOURCES,
  read: (data) => readSender(data, SOURCES),
  compose: (s) => ({ subject: 'Test', text: s.message, replyTo: s.email }),
  secrets: () => ({}),
});

function post(fields: Record<string, string>, json = false): Request {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request('https://example.com/api/contact', {
    method: 'POST',
    body,
    headers: json ? { accept: 'application/json' } : {},
  });
}

describe('the answer', () => {
  const origin = { locale: 'cs', source: 'contact' };

  test('a plain post is redirected to the result page', () => {
    const res = answer(post({}), origin, 'sent');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/cs/contact/sent#contact');
  });

  test('the script gets JSON with a status that fits', async () => {
    expect(answer(post({}, true), origin, 'sent').status).toBe(200);
    expect(answer(post({}, true), origin, 'rate').status).toBe(429);
    expect(answer(post({}, true), origin, 'failed').status).toBe(502);
    const res = answer(post({}, true), origin, 'invalid');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('the endpoint', () => {
  test('a malformed post goes to the invalid page of its language', async () => {
    const res = await POST({ request: post({ locale: 'de', source: 'contact', email: 'nobody', message: 'Hi' }) });
    expect(res.headers.get('location')).toBe('/de/contact/invalid#contact');
  });

  test('without a Turnstile secret nothing is verified and nothing is sent', async () => {
    const res = await POST({
      request: post({ source: 'contact', email: 'name@example.com', message: 'Hi', 'cf-turnstile-response': 'tok' }, true),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'verification' });
  });

  test('a visit goes to the form', () => {
    expect(contactRedirect().headers.get('location')).toBe('/contact');
  });
});
