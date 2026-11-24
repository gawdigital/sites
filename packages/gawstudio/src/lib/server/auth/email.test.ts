import { describe, expect, test } from 'bun:test';

import { isEmail, normaliseEmail } from './email.ts';
import { base64url, fromBase64url, isToken, randomToken, timingSafeEqual } from './encoding.ts';

describe('an address as identity', () => {
  test('white space goes, and case in both parts', () => {
    expect(normaliseEmail('  Name@Example.COM ')).toBe('name@example.com');
  });

  test('nothing provider-specific: dots and tags stay', () => {
    expect(normaliseEmail('first.last+shop@example.com')).toBe('first.last+shop@example.com');
  });

  test('composed and decomposed spellings are one address', () => {
    expect(normaliseEmail('jose\u0301@example.com')).toBe(normaliseEmail('jos\u00e9@example.com'));
  });

  test('what is not an address is refused', () => {
    for (const bad of ['', 'name', '@example.com', 'name@', 'name@example', 'a b@example.com', 'name@-example.com', 'name@example..com', 'name@exa mple.com'])
      expect(isEmail(bad)).toBe(false);
    expect(isEmail(`${'a'.repeat(65)}@example.com`)).toBe(false);
    expect(isEmail(`name@${'a'.repeat(250)}.com`)).toBe(false);
  });

  test('a line break is refused, not repaired', () => {
    expect(normaliseEmail('name@example.com\r\nBcc: other@example.com')).toBeUndefined();
    expect(normaliseEmail('name@example.com\n')).toBeUndefined();
  });
});

describe('tokens and bytes', () => {
  test('a token is 256 random bits as base64url, and no two are alike', () => {
    const a = randomToken();
    expect(isToken(a)).toBe(true);
    expect(fromBase64url(a)).toHaveLength(32);
    expect(randomToken()).not.toBe(a);
  });

  test('base64url round trip, and refusal of what is not base64url', () => {
    const data = new Uint8Array([0, 250, 251, 252, 253, 254, 255]);
    expect(fromBase64url(base64url(data))).toEqual(data);
    expect(base64url(data)).not.toMatch(/[+/=]/);
    expect(fromBase64url('a+b/')).toBeUndefined();
    expect(fromBase64url('abcde')).toBeUndefined();
  });

  test('comparison', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcabc')).toBe(false);
    expect(timingSafeEqual('abc', '')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });
});
