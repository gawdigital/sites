// Cookies as the accounts set them: `HttpOnly; Secure; SameSite=Lax; Path=/` under the `__Host-` prefix, which
// makes the browser refuse the cookie unless it is Secure, host-only and for the whole site, so no subdomain
// can plant one.

export const SESSION_COOKIE = '__Host-session';
/** Holds the `state` of a sign-in under way at a provider, binding the callback to the browser that began it. */
export const OAUTH_COOKIE = '__Host-oauth';

export interface CookieOptions {
  /** Lifetime in seconds; without it the cookie ends with the browser session. `0` removes the cookie. */
  maxAge?: number;
  /**
   * `Lax` unless told otherwise. `None` exists for one case: Apple answers with a cross-site POST
   * (`response_mode=form_post`), which carries no `Lax` cookie, so the short-lived OAuth cookie must be `None`
   * there. The session cookie is always `Lax`.
   */
  sameSite?: 'Lax' | 'Strict' | 'None';
}

// RFC 6265's cookie-octet: our values are base64url, anything else is a programming error.
const VALUE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;

/** A `Set-Cookie` header value. */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  if (!VALUE.test(value)) throw new TypeError('auth: not a cookie value');
  const parts = [`${name}=${value}`, 'HttpOnly', 'Secure', `SameSite=${options.sameSite ?? 'Lax'}`, 'Path=/'];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  return parts.join('; ');
}

/** The `Set-Cookie` value that removes a cookie: same attributes, no value, no lifetime. */
export function clearCookie(name: string, options: Pick<CookieOptions, 'sameSite'> = {}): string {
  return serializeCookie(name, '', { ...options, maxAge: 0 });
}

/** A cookie's value from a request's `Cookie` header; `undefined` when absent or empty. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  for (const pair of (header ?? '').split(';')) {
    const eq = pair.indexOf('=');
    if (eq > 0 && pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim() || undefined;
  }
  return undefined;
}

/** The session cookie for a token, living until the session's absolute end. */
export function sessionCookie(token: string, expiresAt: number, now: number): string {
  return serializeCookie(SESSION_COOKIE, token, { maxAge: (expiresAt - now) / 1000 });
}

export const clearSessionCookie = (): string => clearCookie(SESSION_COOKIE);

export const readSessionCookie = (header: string | null | undefined): string | undefined => readCookie(header, SESSION_COOKIE);

/**
 * A path on this site to send the visitor to after signing in, or `fallback`: never another site, whatever a
 * `returnTo` parameter says.
 */
export function localPath(path: string | null | undefined, fallback = '/'): string {
  if (!path || !path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u001F]/.test(path)) return fallback;
  return path;
}
