import { describe, expect, test } from 'bun:test';

import { cleanLine, cleanText, isEmail, MAX_MESSAGE, readOrigin, readSender, resultPath } from './form.ts';
import { FORM_STATES, isFormState } from './states.ts';

const SOURCES = ['contact', 'support'] as const;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

const valid = { locale: 'de', source: 'support', email: 'name@example.com', message: 'Hello', 'cf-turnstile-response': 'tok' };

describe('the form states', () => {
  test('only the known outcomes are states', () => {
    for (const state of FORM_STATES) expect(isFormState(state)).toBe(true);
    expect(isFormState('done')).toBe(false);
  });
});

describe('cleaning', () => {
  test('a message keeps its line breaks and loses control characters', () => {
    expect(cleanText('  a\r\nb\rc\u0000‎  ')).toBe('a\nb\nc');
  });

  test('a header value is one line', () => {
    expect(cleanLine(' a\r\nb c ')).toBe('abc');
  });

  test('an address needs a name, a domain and a dot', () => {
    expect(isEmail('name@example.com')).toBe(true);
    expect(isEmail('name@example')).toBe(false);
    expect(isEmail(`${'a'.repeat(250)}@example.com`)).toBe(false);
  });
});

describe('reading a post', () => {
  test('an unknown locale or source falls back to English and the first source', () => {
    expect(readOrigin(form({ locale: 'xx', source: 'admin' }), SOURCES)).toEqual({ locale: 'en', source: 'contact' });
    expect(readOrigin(form({ locale: 'cs', source: 'support' }), SOURCES)).toEqual({ locale: 'cs', source: 'support' });
  });

  test('a valid post is read with its token', () => {
    expect(readSender(form(valid), SOURCES)).toEqual({
      locale: 'de',
      source: 'support',
      email: 'name@example.com',
      message: 'Hello',
      token: 'tok',
    });
  });

  test('a line break in the address is refused, not repaired', () => {
    expect(readSender(form({ ...valid, email: 'name@example.com\r\nBcc: other@example.com' }), SOURCES)).toBeUndefined();
  });

  test('an empty or oversized message is refused', () => {
    expect(readSender(form({ ...valid, message: '   ' }), SOURCES)).toBeUndefined();
    expect(readSender(form({ ...valid, message: 'a'.repeat(MAX_MESSAGE + 1) }), SOURCES)).toBeUndefined();
  });
});

describe('the result page', () => {
  test('it is the form page of the visitor\'s language, with English paths', () => {
    expect(resultPath({ locale: 'en', source: 'contact' }, 'sent')).toBe('/contact/sent#contact');
    expect(resultPath({ locale: 'de', source: 'support' }, 'rate')).toBe('/de/support/rate#contact');
  });
});
