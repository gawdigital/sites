// Signing in with Google or Apple: OpenID Connect's authorisation code flow, all redirects and one form post,
// so it works without JavaScript. Each provider is a description; one pair of functions drives either.
//
// The flow: `beginSignIn` stores a transaction (state, nonce, PKCE verifier), returns the provider's URL to
// redirect to and a cookie holding the state; the provider sends the browser back; `completeSignIn` checks the
// state against the cookie and the stored transaction (once), exchanges the code, validates the ID token and
// signs the provider's user in to the account of their verified address.
//
// Endpoints, issuers and claim rules were read from the providers' own pages on 2026-11-24:
//   Google: https://accounts.google.com/.well-known/openid-configuration and
//           https://developers.google.com/identity/openid-connect/openid-connect
//   Apple:  https://appleid.apple.com/.well-known/openid-configuration, https://appleid.apple.com/auth/keys and,
//           under https://developer.apple.com/documentation/ : signinwithapple/verifying-a-user,
//           signinwithapplejs/authorizationi/id_token, signinwithapplerestapi/generate-and-validate-tokens,
//           signinwithapple/incorporating-sign-in-with-apple-into-other-platforms,
//           accountorganizationaldatasharing/creating-a-client-secret
import { signInWithProvider } from './accounts.ts';
import { clearCookie, localPath, OAUTH_COOKIE, readCookie, serializeCookie } from './cookie.ts';
import { base64url, hashToken, isToken, randomToken, sha256, timingSafeEqual } from './encoding.ts';
import { decodeJwt, signEs256, verifyRs256 } from './jwt.ts';
import type { Jwk, SignatureFailure } from './jwt.ts';
import type { AuthSettings } from './settings.ts';
import type { Account, AuthStore, ProviderId } from './store.ts';

/** The part of `fetch` used here, so tests (and a caching wrapper) can stand in for the network. */
export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<Response>;

/** An OpenID Connect provider, as far as signing in needs to know it. */
export interface OidcProvider {
  id: ProviderId;
  /** Accepted `iss` values. */
  issuers: readonly string[];
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  scope: string;
  /** Whether the provider takes PKCE (`code_challenge`, S256). */
  pkce: boolean;
  /** How the provider comes back: a GET with a query, or a cross-site POST of a form. */
  responseMode: 'query' | 'form_post';
}

/**
 * Google. Both issuer spellings are documented ("Always https://accounts.google.com or accounts.google.com").
 * ID tokens are RS256 (the only value in the discovery document). PKCE: the discovery document lists S256, but
 * the OpenID Connect page for server-side apps does not describe `code_challenge`; it is sent in addition to the
 * client secret, not instead of it (unverified beyond the discovery document).
 */
export const GOOGLE: OidcProvider = {
  id: 'google',
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
  scope: 'openid email',
  pkce: true,
  responseMode: 'query',
};

/**
 * Apple. ID tokens are RS256: the discovery document's only `id_token_signing_alg_values_supported` and the
 * `alg` of every key at `/auth/keys`. (The "Verifying a user" page says "JWS E256 signature", which matches
 * neither RS256 nor ES256; the machine-readable sources win. ES256 is what *we* sign the client secret with.)
 * No PKCE: the discovery document lists no `code_challenge_methods_supported`. Asking for the e-mail scope
 * obliges `response_mode=form_post`, so Apple's answer is a cross-site POST to the redirect URI. The scope is
 * `email` as the authorisation page documents (`name` and `email` are its valid values; `openid` appears in the
 * discovery document only); the name is not asked for, the account being its address.
 */
export const APPLE: OidcProvider = {
  id: 'apple',
  issuers: ['https://appleid.apple.com'],
  authorizationEndpoint: 'https://appleid.apple.com/auth/authorize',
  tokenEndpoint: 'https://appleid.apple.com/auth/token',
  jwksUri: 'https://appleid.apple.com/auth/keys',
  scope: 'email',
  pkce: false,
  responseMode: 'form_post',
};

/** A provider with our registration at it. Identifiers and secrets come from the caller (Cloudflare secrets). */
export interface OidcClient {
  provider: OidcProvider;
  clientId: string;
  /** Where the provider sends the browser back: absolute, registered at the provider. */
  redirectUri: string;
  /** The secret for the token exchange, made per exchange: a constant for Google, a signed JWT for Apple. */
  clientSecret: (now: number) => string | Promise<string>;
}

export function googleClient(config: { clientId: string; clientSecret: string; redirectUri: string }): OidcClient {
  return { provider: GOOGLE, clientId: config.clientId, redirectUri: config.redirectUri, clientSecret: () => config.clientSecret };
}

/** Our key at Apple: the team, the key's id, and the private key itself (`importEs256PrivateKey`). */
export interface AppleKey {
  teamId: string;
  keyId: string;
  privateKey: CryptoKey;
}

/** Apple refuses a client secret that expires more than this far ahead: 15777000 seconds, six months. */
export const APPLE_SECRET_MAX_TTL = 15_777_000_000;

/**
 * Apple's client secret: a JWT we sign with ES256, naming the team (`iss`), the Services ID (`sub`) and Apple
 * (`aud`). Made fresh for each exchange and short-lived by default, so nothing long-lived needs storing.
 */
export async function appleClientSecret(key: AppleKey, clientId: string, now: number, ttl = 5 * 60_000): Promise<string> {
  if (!(ttl > 0) || ttl > APPLE_SECRET_MAX_TTL) throw new RangeError('auth: an Apple client secret lives at most six months');
  const iat = Math.floor(now / 1000);
  const claims = { iss: key.teamId, iat, exp: iat + Math.floor(ttl / 1000), aud: 'https://appleid.apple.com', sub: clientId };
  return signEs256({ kid: key.keyId }, claims, key.privateKey);
}

/** `clientId` is the Services ID. Until the membership exists there is no key: leave Apple out of the page. */
export function appleClient(config: { clientId: string; redirectUri: string; key: AppleKey }): OidcClient {
  const { clientId, redirectUri, key } = config;
  return { provider: APPLE, clientId, redirectUri, clientSecret: (now) => appleClientSecret(key, clientId, now) };
}

// A cross-site form post carries no `SameSite=Lax` cookie, so the state cookie is `None` for such a provider.
const cookieSite = (provider: OidcProvider) => ({ sameSite: provider.responseMode === 'form_post' ? 'None' : 'Lax' }) as const;

export interface SignInStart {
  /** Where to redirect the browser (303). */
  url: string;
  /** The `Set-Cookie` value to send with the redirect. */
  cookie: string;
}

/** Begins a sign-in: remembers what the callback must match and builds the provider's authorisation URL. */
export async function beginSignIn(
  store: AuthStore,
  client: OidcClient,
  options: { now: number; settings: AuthSettings; returnTo?: string | null },
): Promise<SignInStart> {
  const { provider } = client;
  const { now, settings } = options;
  const state = randomToken();
  const nonce = randomToken();
  // 43 base64url characters: within PKCE's 43 to 128.
  const codeVerifier = provider.pkce ? randomToken() : null;
  await store.insertOAuthTransaction({
    stateHash: await hashToken(state),
    provider: provider.id,
    nonce,
    codeVerifier,
    returnTo: localPath(options.returnTo),
    expiresAt: now + settings.oauthTtl,
  });

  const url = new URL(provider.authorizationEndpoint);
  const params: Record<string, string> = {
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    scope: provider.scope,
    state,
    nonce,
  };
  if (provider.responseMode === 'form_post') params.response_mode = 'form_post';
  if (codeVerifier !== null) {
    params.code_challenge = base64url(await sha256(codeVerifier));
    params.code_challenge_method = 'S256';
  }
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  // Apple wants the scope's space as %20; URLSearchParams writes `+`, which only form decoding reads as a space.
  url.search = url.search.replace(/\+/g, '%20');

  const cookie = serializeCookie(OAUTH_COOKIE, state, { ...cookieSite(provider), maxAge: settings.oauthTtl / 1000 });
  return { url: url.href, cookie };
}

/** The `Set-Cookie` value that drops the state cookie once the callback is handled, whatever its outcome. */
export const clearOAuthCookie = (client: OidcClient): string => clearCookie(OAUTH_COOKIE, cookieSite(client.provider));

/** The ID token's claims that signing in uses, validated. */
export interface IdClaims {
  issuer: string;
  subject: string;
  /** As the provider spells it; `signInWithProvider` normalises. Verified by the provider. */
  email: string;
  /** Apple only: the address is a private relay address. It is the account's address all the same. */
  privateEmail: boolean;
}

export type IdTokenFailure =
  | 'malformed'
  | SignatureFailure
  | 'keys-unavailable'
  | 'wrong-issuer'
  | 'wrong-audience'
  | 'expired'
  | 'nonce-mismatch'
  | 'no-subject'
  | 'no-email'
  | 'email-unverified';

export type VerifiedIdToken = { ok: true; claims: IdClaims } | { ok: false; reason: IdTokenFailure };

export interface IdTokenCheck {
  provider: OidcProvider;
  clientId: string;
  /** The nonce sent with the authorisation request. */
  nonce: string;
  now: number;
  /** Tolerated clock difference for `exp`, milliseconds. */
  clockSkew: number;
  fetch: Fetch;
}

/** The provider's current signing keys; `undefined` when they cannot be had. Wrap `fetch` to cache them. */
export async function fetchJwks(fetch: Fetch, jwksUri: string): Promise<Jwk[] | undefined> {
  try {
    const response = await fetch(jwksUri, { headers: { accept: 'application/json' } });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { keys?: unknown };
    if (!Array.isArray(body?.keys)) return undefined;
    return body.keys.filter((k): k is Jwk => typeof k === 'object' && k !== null && typeof (k as Jwk).kty === 'string');
  } catch {
    return undefined;
  }
}

// Apple documents `email_verified` and `is_private_email` as "a string ("true" or "false") or a Boolean".
const isTrue = (claim: unknown): boolean => claim === true || claim === 'true';

/**
 * Validates an ID token: the RS256 signature against the provider's published keys, then `iss`, `aud`, `exp`
 * and `nonce`, and that it carries a subject and an address the provider has verified. Only a token that passes
 * all of it says who is signing in.
 */
export async function verifyIdToken(token: string, check: IdTokenCheck): Promise<VerifiedIdToken> {
  const fail = (reason: IdTokenFailure): VerifiedIdToken => ({ ok: false, reason });
  const jwt = decodeJwt(token);
  if (!jwt) return fail('malformed');
  if (jwt.header.alg !== 'RS256') return fail('unsupported-alg');
  const keys = await fetchJwks(check.fetch, check.provider.jwksUri);
  if (!keys) return fail('keys-unavailable');
  const unsigned = await verifyRs256(jwt, keys);
  if (unsigned) return fail(unsigned);

  const { iss, aud, azp, exp, nonce, sub, email } = jwt.claims;
  if (typeof iss !== 'string' || !check.provider.issuers.includes(iss)) return fail('wrong-issuer');
  // `aud` may be a list (OpenID Connect Core §3.1.3.7): then it must hold us, and `azp` must name us.
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(check.clientId) || (audiences.length > 1 && azp !== check.clientId)) return fail('wrong-audience');
  if (typeof exp !== 'number' || check.now >= exp * 1000 + check.clockSkew) return fail('expired');
  if (typeof nonce !== 'string' || !timingSafeEqual(nonce, check.nonce)) return fail('nonce-mismatch');
  if (typeof sub !== 'string' || sub === '') return fail('no-subject');
  if (typeof email !== 'string' || email === '') return fail('no-email');
  if (!isTrue(jwt.claims.email_verified)) return fail('email-unverified');
  return { ok: true, claims: { issuer: iss, subject: sub, email, privateEmail: isTrue(jwt.claims.is_private_email) } };
}

/** Exchanges the authorisation code for the ID token at the provider's token endpoint; `undefined` on any failure. */
export async function exchangeCode(
  client: OidcClient,
  grant: { code: string; codeVerifier: string | null; now: number; fetch: Fetch },
): Promise<string | undefined> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: grant.code,
    redirect_uri: client.redirectUri,
    client_id: client.clientId,
    client_secret: await client.clientSecret(grant.now),
  });
  if (grant.codeVerifier !== null) body.set('code_verifier', grant.codeVerifier);
  try {
    const response = await grant.fetch(client.provider.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
    if (!response.ok) return undefined;
    const idToken = ((await response.json()) as { id_token?: unknown })?.id_token;
    return typeof idToken === 'string' ? idToken : undefined;
  } catch {
    return undefined;
  }
}

export type SignInFailure =
  /** No state, no cookie, or the two differ: not the browser that began, or a forged callback. */
  | 'state-mismatch'
  /** The state was never issued, or was used already. */
  | 'state-unknown'
  | 'state-expired'
  /** The provider reports an error (the visitor cancelled, mostly): `error` has its code. */
  | 'provider-error'
  | 'no-code'
  | 'exchange-failed'
  | 'invalid-email'
  | IdTokenFailure;

export type SignedIn =
  | { ok: true; account: Account; created: boolean; returnTo: string }
  | { ok: false; reason: SignInFailure; error?: string };

export interface Callback {
  /** The callback's parameters: the query for Google, the posted form for Apple. */
  params: { get(name: string): string | null };
  /** The request's `Cookie` header. */
  cookieHeader: string | null | undefined;
  now: number;
  settings: AuthSettings;
  fetch: Fetch;
}

/**
 * Completes a sign-in from the provider's callback: the account (made on first use, joined by verified address)
 * and where to go, or why not. The caller then starts a session and clears the state cookie.
 */
export async function completeSignIn(store: AuthStore, client: OidcClient, callback: Callback): Promise<SignedIn> {
  const { params, now, settings, fetch } = callback;
  const fail = (reason: SignInFailure, error?: string): SignedIn => ({ ok: false, reason, ...(error === undefined ? {} : { error }) });

  const state = params.get('state');
  const cookie = readCookie(callback.cookieHeader, OAUTH_COOKIE);
  if (!state || !cookie || !isToken(state) || !timingSafeEqual(cookie, state)) return fail('state-mismatch');
  const transaction = await store.takeOAuthTransaction(await hashToken(state));
  if (!transaction) return fail('state-unknown');
  if (transaction.provider !== client.provider.id) return fail('state-mismatch');
  if (now >= transaction.expiresAt) return fail('state-expired');

  const error = params.get('error');
  if (error) return fail('provider-error', error.slice(0, 100));
  const code = params.get('code');
  if (!code) return fail('no-code');

  const idToken = await exchangeCode(client, { code, codeVerifier: transaction.codeVerifier, now, fetch });
  if (idToken === undefined) return fail('exchange-failed');
  const verified = await verifyIdToken(idToken, {
    provider: client.provider,
    clientId: client.clientId,
    nonce: transaction.nonce,
    now,
    clockSkew: settings.clockSkew,
    fetch,
  });
  if (!verified.ok) return fail(verified.reason);

  const { subject, email } = verified.claims;
  const signedIn = await signInWithProvider(store, { provider: client.provider.id, subject, email }, now);
  if (!signedIn) return fail('invalid-email');
  return { ok: true, account: signedIn.account, created: signedIn.created, returnTo: transaction.returnTo };
}
