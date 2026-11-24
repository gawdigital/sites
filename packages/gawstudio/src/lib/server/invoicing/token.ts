// Fakturoid access tokens by the OAuth 2.0 Client Credentials flow: the server asks for one with the client ID and
// secret, keeps it in an injected cache and asks again shortly before it runs out (there is no refresh token in
// this flow). Wire details are from https://www.fakturoid.cz/api/v3/authorization, read 2026-11-24.
import { fail, ok, type InvoicingError, type Result } from './types.ts';

/**
 * Where a token is kept between requests (a KV namespace in production, a map in tests). `set` is given the moment,
 * in milliseconds since the epoch, after which `get` must no longer return the value; a store that cannot expire
 * entries itself must check on `get`.
 */
export interface TokenCache {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, expiresAt: number): Promise<void>;
}

export interface TokenConfig {
  fetch: typeof fetch;
  clientId: string;
  clientSecret: string;
  /**
   * Fakturoid requires `AppName (contact e-mail)` and answers 400 without it. The contact is configuration, kept
   * with the secrets: it is never written in this repository.
   */
  userAgent: string;
  cache: TokenCache;
  /** Milliseconds since the epoch. */
  now: () => number;
  /** Without a trailing slash. */
  baseUrl?: string;
  cacheKey?: string;
}

export const FAKTUROID_API = 'https://app.fakturoid.cz/api/v3';
export const TOKEN_CACHE_KEY = 'fakturoid:access-token';

/** A token is given up this long before Fakturoid would: a request never leaves with one about to lapse. */
export const RENEW_MARGIN_SECONDS = 300;

/** Used when the response does not say: the documented lifetime of two hours. */
const DEFAULT_LIFETIME_SECONDS = 7200;

/**
 * `Basic` credentials. The documentation calls the encoding "urlsafe Base64" yet shows a padded value; for the
 * characters credentials are made of (letters, digits, `-`, `_`) the standard and the URL-safe alphabets give the
 * same string, so this is the standard one of RFC 7617.
 */
export function basicAuth(clientId: string, clientSecret: string): string {
  const bytes = new TextEncoder().encode(`${clientId}:${clientSecret}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

export interface TokenSource {
  /** The cached token, or a new one. `forceNew` skips the cache: for after a 401. */
  token(options?: { forceNew?: boolean }): Promise<Result<string>>;
}

export function createTokenSource(config: TokenConfig): TokenSource {
  const key = config.cacheKey ?? TOKEN_CACHE_KEY;
  // Requests that find no token at the same moment share one token request instead of each making their own.
  let pending: Promise<Result<string>> | undefined;

  async function request(): Promise<Result<string>> {
    let response: Response;
    try {
      response = await config.fetch(`${config.baseUrl ?? FAKTUROID_API}/oauth/token`, {
        method: 'POST',
        headers: {
          'User-Agent': config.userAgent,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: basicAuth(config.clientId, config.clientSecret),
        },
        body: JSON.stringify({ grant_type: 'client_credentials' }),
      });
    } catch {
      return fail({ kind: 'unavailable', message: 'The token endpoint could not be reached.' });
    }
    if (!response.ok) return fail(await tokenError(response));

    const body: unknown = await response.json().catch(() => undefined);
    const token = readToken(body);
    if (!token) return fail({ kind: 'unexpected', message: 'The token response holds no bearer token.', status: response.status });

    const lifetime = Math.max(token.expiresIn - RENEW_MARGIN_SECONDS, 0);
    // A token we cannot store still works for this request.
    if (lifetime > 0) await config.cache.set(key, token.value, config.now() + lifetime * 1000).catch(() => undefined);
    return ok(token.value);
  }

  return {
    async token({ forceNew = false } = {}) {
      if (!forceNew) {
        const cached = await config.cache.get(key).catch(() => undefined);
        if (cached) return ok(cached);
      }
      pending ??= request().finally(() => {
        pending = undefined;
      });
      return pending;
    },
  };
}

function readToken(body: unknown): { value: string; expiresIn: number } | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const { access_token, token_type, expires_in } = body as Record<string, unknown>;
  if (typeof access_token !== 'string' || access_token === '') return undefined;
  // The API is used with `Authorization: <token_type> <access_token>`; only Bearer is documented.
  if (typeof token_type === 'string' && token_type.toLowerCase() !== 'bearer') return undefined;
  return { value: access_token, expiresIn: typeof expires_in === 'number' && expires_in > 0 ? expires_in : DEFAULT_LIFETIME_SECONDS };
}

async function tokenError(response: Response): Promise<InvoicingError> {
  const body: unknown = await response.json().catch(() => undefined);
  const description =
    typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>).error_description === 'string'
      ? ((body as Record<string, unknown>).error_description as string)
      : `The token request was answered with ${response.status}.`;
  if (response.status === 429) return { kind: 'rate_limited', message: description };
  if (response.status >= 500) return { kind: 'unavailable', message: description, status: response.status };
  // UNVERIFIED: the documentation does not say which status wrong client credentials get; RFC 6749 allows 400
  // (`invalid_client`) as well as 401, so both read as "the credentials do not work".
  if (response.status === 400 || response.status === 401) return { kind: 'unauthorized', message: description };
  return { kind: 'unexpected', message: description, status: response.status };
}

/** A cache for one isolate's lifetime, and for tests: a token survives requests, not deployments. */
export class MemoryTokenCache implements TokenCache {
  readonly #entries = new Map<string, { value: string; expiresAt: number }>();
  readonly #now: () => number;

  constructor(now: () => number) {
    this.#now = now;
  }

  async get(key: string): Promise<string | undefined> {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: string, expiresAt: number): Promise<void> {
    this.#entries.set(key, { value, expiresAt });
  }
}
