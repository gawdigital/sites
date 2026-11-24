// The few byte-level helpers the accounts need, on Web APIs only (Workers and Bun alike): base64url, SHA-256,
// random tokens and a comparison that does not leak where two values differ.

const encoder = new TextEncoder();

/** A view's bytes in a buffer of their own: what WebCrypto's parameters are typed to take. */
export function bytes(view: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(view);
}

export function utf8(s: string): Uint8Array<ArrayBuffer> {
  return bytes(encoder.encode(s));
}

/** Base64url without padding (RFC 4648 §5): safe in a URL, a cookie and a JWT alike. */
export function base64url(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The bytes of a base64url string; `undefined` when it is not one. */
export function fromBase64url(s: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return undefined;
  const binary = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function sha256(s: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(s)));
}

/** How many random bytes a token carries: 256 bits, far beyond guessing. */
export const TOKEN_BYTES = 32;

/** What a token of ours looks like: 32 bytes as base64url. Anything else is refused before the store is asked. */
export const isToken = (s: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(s);

/** A fresh secret for a link, a cookie, a `state` or a `nonce`. */
export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/** A fresh public identifier (an account's id): random, so it says nothing about order or count. */
export const randomId = (): string => crypto.randomUUID();

/**
 * What the store keeps instead of a token: its SHA-256. A fast hash is enough because the token is 256 random
 * bits, not a password; a leaked table then opens no link and no session.
 */
export async function hashToken(token: string): Promise<string> {
  return base64url(await sha256(token));
}

/** Whether two strings are equal, in time that depends on the first one's length only. */
export function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i % (b.length || 1));
  return diff === 0;
}
