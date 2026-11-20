import { describe, expect, test } from 'bun:test';

import { contactEndpoint } from '@gaw/contact/endpoint.ts';

import { SOURCES, TOPICS, compose, readSubmission } from './contact.ts';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

const valid = {
  email: 'visitor@example.com',
  topic: 'studio',
  message: 'We would like to record an EP.',
  locale: 'cs',
  source: 'contact',
  'cf-turnstile-response': 'token',
};

describe('readSubmission', () => {
  test('accepts a complete form', () => {
    expect(readSubmission(form(valid))).toEqual({
      email: 'visitor@example.com',
      topic: 'studio',
      message: 'We would like to record an EP.',
      locale: 'cs',
      source: 'contact',
      token: 'token',
    });
  });

  test('refuses a missing or unknown topic', () => {
    const { topic: _, ...rest } = valid;
    expect(readSubmission(form(rest))).toBeUndefined();
    expect(readSubmission(form({ ...valid, topic: 'toString' }))).toBeUndefined();
  });

  test('refuses a malformed address and an empty message', () => {
    expect(readSubmission(form({ ...valid, email: 'no-at-sign.example.com' }))).toBeUndefined();
    expect(readSubmission(form({ ...valid, email: 'visitor@example.com\nBcc: other@example.com' }))).toBeUndefined();
    expect(readSubmission(form({ ...valid, message: ' ' }))).toBeUndefined();
  });
});

describe('compose', () => {
  test('the topic goes into the subject', () => {
    for (const topic of Object.keys(TOPICS) as (keyof typeof TOPICS)[]) {
      const mail = compose(readSubmission(form({ ...valid, topic }))!);
      expect(mail.subject).toBe(`[gawgroup.cz] ${TOPICS[topic]}`);
    }
  });

  test('the message names its sender, topic and page, and replies go to the sender', () => {
    const mail = compose(readSubmission(form(valid))!);
    expect(mail.replyTo).toBe('visitor@example.com');
    expect(mail.text).toBe(
      'From: visitor@example.com\nTopic: G.A.W.Studio\nPage: /cs/contact (cs)\n\nWe would like to record an EP.\n',
    );
  });
});

describe('POST /api/contact', () => {
  const POST = contactEndpoint({ sources: SOURCES, read: readSubmission, compose, secrets: () => ({}) });
  const post = (fields: Record<string, string>) =>
    POST({ request: new Request('https://gawgroup.cz/api/contact', { method: 'POST', body: form(fields) }) });

  test('a post without a topic goes back to the form of its language', async () => {
    const res = await post({ ...valid, topic: '' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/cs/contact/invalid#contact');
  });

  test('without the Turnstile secret nothing is sent', async () => {
    const res = await post(valid);
    expect(res.headers.get('location')).toBe('/cs/contact/verification#contact');
  });
});
