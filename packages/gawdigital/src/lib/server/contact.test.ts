import { describe, expect, test } from 'bun:test';

import { cleanLine, cleanText, compose, isEmail, readOrigin, readSubmission, resultPath } from './contact.ts';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

const valid = {
  email: 'visitor@example.com',
  product: 'midi-control',
  topic: 'problem',
  message: 'The meters stay dark.',
  locale: 'de',
  source: 'support',
  'cf-turnstile-response': 'token',
};

describe('readSubmission', () => {
  test('accepts a complete form', () => {
    expect(readSubmission(form(valid))).toEqual({
      email: 'visitor@example.com',
      product: 'midi-control',
      topic: 'problem',
      message: 'The meters stay dark.',
      locale: 'de',
      source: 'support',
      token: 'token',
    });
  });

  test('refuses a missing or malformed address', () => {
    expect(readSubmission(form({ ...valid, email: '' }))).toBeUndefined();
    expect(readSubmission(form({ ...valid, email: 'no-at-sign.example.com' }))).toBeUndefined();
    expect(readSubmission(form({ ...valid, email: 'a@b' }))).toBeUndefined();
    expect(readSubmission(form({ ...valid, email: `${'a'.repeat(250)}@example.com` }))).toBeUndefined();
  });

  test('refuses an address carrying a header', () => {
    expect(readSubmission(form({ ...valid, email: 'visitor@example.com\r\nBcc: other@example.com' }))).toBeUndefined();
    expect(readSubmission(form({ ...valid, email: 'visitor@example.com\nX: y' }))).toBeUndefined();
  });

  test('refuses an unknown product or topic', () => {
    expect(readSubmission(form({ ...valid, product: '' }))).toBeUndefined();
    expect(readSubmission(form({ ...valid, product: 'toString' }))).toBeUndefined();
    expect(readSubmission(form({ ...valid, topic: 'spam' }))).toBeUndefined();
  });

  test('refuses an empty or oversized message', () => {
    expect(readSubmission(form({ ...valid, message: '  \n\t ' }))).toBeUndefined();
    expect(readSubmission(form({ ...valid, message: 'x'.repeat(5001) }))).toBeUndefined();
    expect(readSubmission(form({ ...valid, message: 'x'.repeat(5000) }))).toBeDefined();
  });

  test('trims the address and cleans the message', () => {
    const s = readSubmission(form({ ...valid, email: '  visitor@example.com ', message: ' a\r\nb\u0000c\u202E \n' }));
    expect(s?.email).toBe('visitor@example.com');
    expect(s?.message).toBe('a\nbc');
  });
});

describe('cleaning', () => {
  test('cleanText keeps line breaks and tabs, drops other controls', () => {
    expect(cleanText('one\r\ntwo\rthree\tfour\u0007\u001B[0m')).toBe('one\ntwo\nthree\tfour[0m');
  });

  test('cleanLine leaves one line', () => {
    expect(cleanLine(' a\r\nb\u2028c ')).toBe('abc');
  });

  test('isEmail', () => {
    expect(isEmail('name@example.com')).toBe(true);
    expect(isEmail('name@example')).toBe(false);
    expect(isEmail('na me@example.com')).toBe(false);
  });
});

describe('origin and result', () => {
  test('unknown values fall back to the English contact page', () => {
    expect(readOrigin(form({ locale: 'xx', source: '../admin' }))).toEqual({ locale: 'en', source: 'contact' });
    expect(readOrigin(form({ locale: 'en', source: 'contact' }))).toEqual({ locale: 'en', source: 'contact' });
  });

  test('result pages keep the locale and the form', () => {
    expect(resultPath({ locale: 'en', source: 'contact' }, 'sent')).toBe('/contact/sent#contact');
    expect(resultPath({ locale: 'cs', source: 'support' }, 'rate')).toBe('/cs/support/rate#contact');
  });
});

describe('compose', () => {
  test('a fixed subject from labels, the visitor as Reply-To', () => {
    const s = readSubmission(form(valid))!;
    const mail = compose(s);
    expect(mail.subject).toBe('[gawdigital.cz] MIDI Control for Fireface · Problem');
    expect(mail.replyTo).toBe('visitor@example.com');
    expect(mail.text).toContain('Page: /de/support (de)');
    expect(mail.text).toEndWith('The meters stay dark.\n');
  });
});
