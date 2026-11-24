import { beforeAll, describe, expect, test } from 'bun:test';

import { signInWithProvider } from './accounts.ts';
import { OAUTH_COOKIE, readCookie } from './cookie.ts';
import { base64url, hashToken, sha256, utf8 } from './encoding.ts';
import { decodeJwt, importEs256PrivateKey, signEs256, verifyRs256 } from './jwt.ts';
import type { Jwk } from './jwt.ts';
import { issueMagicLink, redeem } from './magic-link.ts';
import { MemoryAuthStore } from './memory-store.ts';
import {
  APPLE,
  APPLE_SECRET_MAX_TTL,
  appleClient,
  appleClientSecret,
  beginSignIn,
  clearOAuthCookie,
  completeSignIn,
  GOOGLE,
  googleClient,
  verifyIdToken,
} from './oauth.ts';
import type { Fetch, OidcClient, OidcProvider } from './oauth.ts';
import { DEFAULT_AUTH_SETTINGS as settings } from './settings.ts';

const NOW = 1_800_000_000_000;
const SECONDS = NOW / 1000;
const RSA = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };

interface Signer {
  jwk: Jwk;
  sign(claims: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>;
}

/** A provider's signing key, made for the test: the public half as a JWK, the private half to sign ID tokens. */
async function signer(kid: string): Promise<Signer> {
  const pair = await crypto.subtle.generateKey(RSA, true, ['sign', 'verify']);
  const { n, e } = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as { n: string; e: string };
  const part = (value: unknown): string => base64url(utf8(JSON.stringify(value)));
  return {
    jwk: { kty: 'RSA', kid, use: 'sig', alg: 'RS256', n, e },
    async sign(claims, header = {}) {
      const signed = `${part({ alg: 'RS256', kid, ...header })}.${part(claims)}`;
      const signature = await crypto.subtle.sign(RSA.name, pair.privateKey, utf8(signed));
      return `${signed}.${base64url(new Uint8Array(signature))}`;
    },
  };
}

let key: Signer;
let rogue: Signer;
let applePem: string;
let applePublic: CryptoKey;

beforeAll(async () => {
  key = await signer('key-1');
  rogue = await signer('key-1');
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const lines = btoa(String.fromCharCode(...der)).match(/.{1,64}/g)!;
  applePem = `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`;
  applePublic = pair.publicKey;
});

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Call {
  url: string;
  method: string;
  body: URLSearchParams;
}

/** The network: the provider's key set and token endpoint, with every call recorded. */
function network(provider: OidcProvider, keys: Jwk[], token: (body: URLSearchParams) => Promise<Response> | Response = () => json({}, 400)) {
  const calls: Call[] = [];
  const fetch: Fetch = async (url, init) => {
    const body = new URLSearchParams(init?.body ?? '');
    calls.push({ url, method: init?.method ?? 'GET', body });
    if (url === provider.jwksUri) return json({ keys });
    if (url === provider.tokenEndpoint) return token(body);
    return json({}, 404);
  };
  return { fetch, calls };
}

const CLIENT_ID = 'client-1.apps.example';
const NONCE = 'nonce-of-this-sign-in';

const claims = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  sub: 'google-user-1',
  email: 'Name@Example.com',
  email_verified: true,
  nonce: NONCE,
  iat: SECONDS - 10,
  exp: SECONDS + 3600,
  ...over,
});

const check = (fetch: Fetch, provider = GOOGLE) => ({ provider, clientId: CLIENT_ID, nonce: NONCE, now: NOW, clockSkew: settings.clockSkew, fetch });

describe('validating an ID token', () => {
  const verify = async (token: string, keys: Jwk[] = [key.jwk]) => verifyIdToken(token, check(network(GOOGLE, keys).fetch));
  const reason = async (over: Record<string, unknown>) => {
    const result = await verify(await key.sign(claims(over)));
    return result.ok ? 'ok' : result.reason;
  };

  test('a token signed by the provider, for us, for this sign-in, is accepted', async () => {
    const { fetch, calls } = network(GOOGLE, [(await signer('older')).jwk, key.jwk]);
    const result = await verifyIdToken(await key.sign(claims()), check(fetch));
    expect(result).toEqual({
      ok: true,
      claims: { issuer: 'https://accounts.google.com', subject: 'google-user-1', email: 'Name@Example.com', privateEmail: false },
    });
    expect(calls.map((c) => c.url)).toEqual([GOOGLE.jwksUri]);
  });

  test('a signature by another key is refused, even under the same key id', async () => {
    expect(await verify(await rogue.sign(claims()))).toEqual({ ok: false, reason: 'bad-signature' });
  });

  test('changed claims under the original signature are refused', async () => {
    const [h, , s] = (await key.sign(claims())).split('.');
    const forged = `${h}.${base64url(utf8(JSON.stringify(claims({ email: 'victim@example.com' }))))}.${s}`;
    expect(await verify(forged)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  test('a key the provider does not publish is refused', async () => {
    expect(await verify(await key.sign(claims()), [(await signer('key-2')).jwk])).toEqual({ ok: false, reason: 'unknown-key' });
    expect(await verify(await key.sign(claims(), { kid: undefined }))).toEqual({ ok: false, reason: 'unknown-key' });
  });

  test('the algorithm is not the token’s to choose', async () => {
    const part = (value: unknown): string => base64url(utf8(JSON.stringify(value)));
    const none = `${part({ alg: 'none', kid: 'key-1' })}.${part(claims())}.AA`;
    expect(await verify(none)).toEqual({ ok: false, reason: 'unsupported-alg' });
    // The classic confusion: the public key used as an HMAC secret.
    const signed = `${part({ alg: 'HS256', kid: 'key-1' })}.${part(claims())}`;
    const hmacKey = await crypto.subtle.importKey('raw', utf8(key.jwk.n!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = base64url(new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, utf8(signed))));
    expect(await verify(`${signed}.${mac}`)).toEqual({ ok: false, reason: 'unsupported-alg' });
  });

  test('what is not a token is malformed', async () => {
    for (const bad of ['', 'a.b', 'a.b.c', `${base64url(utf8('[]'))}.${base64url(utf8('{}'))}.AA`])
      expect(await verify(bad)).toEqual({ ok: false, reason: 'malformed' });
  });

  test('another issuer is refused', async () => {
    expect(await reason({ iss: 'https://accounts.example.com' })).toBe('wrong-issuer');
    expect(await reason({ iss: 'https://appleid.apple.com' })).toBe('wrong-issuer');
    expect(await reason({ iss: undefined })).toBe('wrong-issuer');
    expect(await reason({ iss: 'accounts.google.com' })).toBe('ok');
  });

  test('a token for another client is refused', async () => {
    expect(await reason({ aud: 'client-2.apps.example' })).toBe('wrong-audience');
    expect(await reason({ aud: undefined })).toBe('wrong-audience');
    expect(await reason({ aud: [CLIENT_ID, 'other'] })).toBe('wrong-audience');
    expect(await reason({ aud: [CLIENT_ID, 'other'], azp: CLIENT_ID })).toBe('ok');
    expect(await reason({ aud: [CLIENT_ID] })).toBe('ok');
  });

  test('an expired token is refused, the clock skew allowed for', async () => {
    expect(await reason({ exp: SECONDS - 3600 })).toBe('expired');
    expect(await reason({ exp: SECONDS - settings.clockSkew / 1000 })).toBe('expired');
    expect(await reason({ exp: SECONDS - settings.clockSkew / 1000 + 1 })).toBe('ok');
    expect(await reason({ exp: undefined })).toBe('expired');
    expect(await reason({ exp: String(SECONDS + 3600) })).toBe('expired');
  });

  test('a token for another sign-in (nonce) is refused', async () => {
    expect(await reason({ nonce: 'another-nonce' })).toBe('nonce-mismatch');
    expect(await reason({ nonce: undefined })).toBe('nonce-mismatch');
  });

  test('an address the provider has not verified is refused', async () => {
    expect(await reason({ email_verified: false })).toBe('email-unverified');
    expect(await reason({ email_verified: 'false' })).toBe('email-unverified');
    expect(await reason({ email_verified: undefined })).toBe('email-unverified');
    expect(await reason({ email_verified: 1 })).toBe('email-unverified');
    expect(await reason({ email: undefined })).toBe('no-email');
    expect(await reason({ sub: '' })).toBe('no-subject');
  });

  test('Apple’s spelling: verified as a string, and the relay address', async () => {
    const token = await key.sign(
      claims({ iss: 'https://appleid.apple.com', sub: 'apple-user-1', email: 'relay1@privaterelay.example.com', email_verified: 'true', is_private_email: 'true' }),
    );
    const result = await verifyIdToken(token, check(network(APPLE, [key.jwk]).fetch, APPLE));
    expect(result).toEqual({
      ok: true,
      claims: { issuer: 'https://appleid.apple.com', subject: 'apple-user-1', email: 'relay1@privaterelay.example.com', privateEmail: true },
    });
  });

  test('without the provider’s keys nothing is accepted', async () => {
    const token = await key.sign(claims());
    const down: Fetch = async () => json({}, 503);
    const broken: Fetch = async () => new Response('<html>', { status: 200 });
    const offline: Fetch = async () => Promise.reject(new Error('offline'));
    for (const fetch of [down, broken, offline]) expect(await verifyIdToken(token, check(fetch))).toEqual({ ok: false, reason: 'keys-unavailable' });
  });

  test('an RSA key marked for another use or algorithm is not a signing key', async () => {
    const jwt = decodeJwt(await key.sign(claims()))!;
    expect(await verifyRs256(jwt, [key.jwk])).toBeUndefined();
    expect(await verifyRs256(jwt, [{ ...key.jwk, use: 'enc' }])).toBe('unknown-key');
    expect(await verifyRs256(jwt, [{ ...key.jwk, alg: 'RS512' }])).toBe('unknown-key');
    expect(await verifyRs256(jwt, [{ ...key.jwk, n: '!' }])).toBe('unknown-key');
  });
});

describe('Apple’s client secret', () => {
  test('is an ES256 JWT naming the team, the client and Apple, verifiable with the public key', async () => {
    const privateKey = await importEs256PrivateKey(applePem);
    const secret = await appleClientSecret({ teamId: 'TEAM123456', keyId: 'KEY1234567', privateKey }, 'com.example.web', NOW);
    const jwt = decodeJwt(secret)!;
    expect(jwt.header).toEqual({ kid: 'KEY1234567', alg: 'ES256' });
    expect(jwt.claims).toEqual({ iss: 'TEAM123456', iat: SECONDS, exp: SECONDS + 300, aud: 'https://appleid.apple.com', sub: 'com.example.web' });
    expect(jwt.signature).toHaveLength(64);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, applePublic, jwt.signature, utf8(jwt.signed))).toBe(true);
    expect(privateKey.extractable).toBe(false);
  });

  test('the header cannot choose another algorithm', async () => {
    const privateKey = await importEs256PrivateKey(applePem);
    expect(decodeJwt(await signEs256({ alg: 'none' }, {}, privateKey))?.header.alg).toBe('ES256');
  });

  test('cannot outlive six months', async () => {
    const appleKey = { teamId: 'T', keyId: 'K', privateKey: await importEs256PrivateKey(applePem) };
    expect(appleClientSecret(appleKey, 'c', NOW, APPLE_SECRET_MAX_TTL + 1)).rejects.toThrow(RangeError);
    expect(appleClientSecret(appleKey, 'c', NOW, 0)).rejects.toThrow(RangeError);
    expect(await appleClientSecret(appleKey, 'c', NOW, APPLE_SECRET_MAX_TTL)).toBeString();
  });

  test('what is not a key is refused', async () => {
    expect(importEs256PrivateKey('not a key!')).rejects.toThrow();
  });
});

const google = (): OidcClient =>
  googleClient({ clientId: CLIENT_ID, clientSecret: 'google-secret', redirectUri: 'https://studio.example/account/google' });

/** Begins a sign-in and reads back what the browser would carry. */
async function begun(store: MemoryAuthStore, client: OidcClient, returnTo?: string) {
  const start = await beginSignIn(store, client, { now: NOW, settings, returnTo });
  const url = new URL(start.url);
  const state = url.searchParams.get('state')!;
  return { start, url, state, nonce: url.searchParams.get('nonce')!, cookieHeader: `${OAUTH_COOKIE}=${state}` };
}

describe('the authorisation redirect', () => {
  test('Google: code flow with state, nonce and PKCE', async () => {
    const store = new MemoryAuthStore();
    const { start, url, state, nonce } = await begun(store, google(), '/account/orders');
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: 'https://studio.example/account/google',
      scope: 'openid email',
      state,
      nonce,
      code_challenge: expect.any(String),
      code_challenge_method: 'S256',
    });
    expect(state).not.toBe(nonce);
    const [transaction] = [...store.transactions.values()];
    expect(transaction).toMatchObject({ stateHash: await hashToken(state), provider: 'google', nonce, returnTo: '/account/orders', expiresAt: NOW + settings.oauthTtl });
    expect(url.searchParams.get('code_challenge')).toBe(base64url(await sha256(transaction!.codeVerifier!)));
    expect(start.url).not.toContain(transaction!.codeVerifier!);
    expect(start.cookie).toBe(`__Host-oauth=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${settings.oauthTtl / 1000}`);
    expect(clearOAuthCookie(google())).toBe('__Host-oauth=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  });

  test('Apple: a form post back, no PKCE, and a state cookie that survives the cross-site post', async () => {
    const store = new MemoryAuthStore();
    const key = { teamId: 'TEAM123456', keyId: 'KEY1234567', privateKey: await importEs256PrivateKey(applePem) };
    const client = appleClient({ clientId: 'com.example.web', redirectUri: 'https://studio.example/account/apple', key });
    const { start, url, state, nonce } = await begun(store, client);
    expect(url.origin + url.pathname).toBe('https://appleid.apple.com/auth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      response_mode: 'form_post',
      client_id: 'com.example.web',
      redirect_uri: 'https://studio.example/account/apple',
      scope: 'email',
      state,
      nonce,
    });
    expect([...store.transactions.values()][0]?.codeVerifier).toBeNull();
    expect(readCookie(start.cookie.split(';')[0], OAUTH_COOKIE)).toBe(state);
    expect(start.cookie).toContain('; HttpOnly; Secure; SameSite=None; Path=/;');
    expect(clearOAuthCookie(client)).toContain('SameSite=None');
  });

  test('a space in a scope is written as %20', async () => {
    const { start } = await begun(new MemoryAuthStore(), google());
    expect(start.url).toContain('scope=openid%20email');
    expect(start.url).not.toContain('+');
  });

  test('the way back cannot leave the site', async () => {
    const store = new MemoryAuthStore();
    await begun(store, google(), 'https://evil.example/');
    expect([...store.transactions.values()][0]?.returnTo).toBe('/');
  });
});

describe('the callback', () => {
  /** A provider that answers the code `good-code` with an ID token for the sign-in's nonce. */
  const provider = (nonce: string, over: Record<string, unknown> = {}, p = GOOGLE) =>
    network(p, [key.jwk], async (body) => (body.get('code') === 'good-code' ? json({ id_token: await key.sign(claims({ nonce, ...over })) }) : json({ error: 'invalid_grant' }, 400)));

  const params = (fields: Record<string, string>) => new URLSearchParams(fields);

  test('Google, start to finish: the exchange carries the secret and the verifier, the account is made', async () => {
    const store = new MemoryAuthStore();
    const client = google();
    const { state, nonce, cookieHeader } = await begun(store, client, '/account/orders');
    const verifier = [...store.transactions.values()][0]!.codeVerifier!;
    const { fetch, calls } = provider(nonce);

    const result = await completeSignIn(store, client, { params: params({ state, code: 'good-code' }), cookieHeader, now: NOW + 5000, settings, fetch });
    if (!result.ok) throw new Error(result.reason);
    expect(result.created).toBe(true);
    expect(result.returnTo).toBe('/account/orders');
    expect(result.account).toMatchObject({ email: 'name@example.com', emailVerifiedAt: NOW + 5000 });
    expect(await store.identity('google', 'google-user-1')).toMatchObject({ accountId: result.account.id });

    const exchange = calls.find((c) => c.url === GOOGLE.tokenEndpoint)!;
    expect(exchange.method).toBe('POST');
    expect(Object.fromEntries(exchange.body)).toEqual({
      grant_type: 'authorization_code',
      code: 'good-code',
      redirect_uri: 'https://studio.example/account/google',
      client_id: CLIENT_ID,
      client_secret: 'google-secret',
      code_verifier: verifier,
    });
  });

  test('a state works once', async () => {
    const store = new MemoryAuthStore();
    const { state, nonce, cookieHeader } = await begun(store, google());
    const callback = { params: params({ state, code: 'good-code' }), cookieHeader, now: NOW, settings, fetch: provider(nonce).fetch };
    expect((await completeSignIn(store, google(), callback)).ok).toBe(true);
    expect(await completeSignIn(store, google(), callback)).toEqual({ ok: false, reason: 'state-unknown' });
  });

  test('the state must match the cookie of the browser that began', async () => {
    const store = new MemoryAuthStore();
    const mine = await begun(store, google());
    const theirs = await begun(store, google());
    const { fetch, calls } = provider(theirs.nonce);
    const attempt = (state: string | undefined, cookieHeader: string | null) =>
      completeSignIn(store, google(), { params: params({ ...(state ? { state } : {}), code: 'good-code' }), cookieHeader, now: NOW, settings, fetch });
    // An attacker's callback (their state and code) opened in my browser: login CSRF.
    expect(await attempt(theirs.state, mine.cookieHeader)).toEqual({ ok: false, reason: 'state-mismatch' });
    expect(await attempt(theirs.state, null)).toEqual({ ok: false, reason: 'state-mismatch' });
    expect(await attempt(undefined, mine.cookieHeader)).toEqual({ ok: false, reason: 'state-mismatch' });
    expect(await attempt('invented', `${OAUTH_COOKIE}=invented`)).toEqual({ ok: false, reason: 'state-mismatch' });
    // None of it reached the provider or spent a transaction.
    expect(calls).toHaveLength(0);
    expect(store.transactions.size).toBe(2);
  });

  test('a state from one provider does not complete at the other', async () => {
    const store = new MemoryAuthStore();
    const { state, cookieHeader } = await begun(store, google());
    const key = { teamId: 'T', keyId: 'K', privateKey: await importEs256PrivateKey(applePem) };
    const apple = appleClient({ clientId: 'com.example.web', redirectUri: 'https://studio.example/account/apple', key });
    const { fetch } = network(APPLE, []);
    expect(await completeSignIn(store, apple, { params: params({ state, code: 'c' }), cookieHeader, now: NOW, settings, fetch })).toEqual({
      ok: false,
      reason: 'state-mismatch',
    });
  });

  test('coming back too late, cancelling, and a refused code', async () => {
    const store = new MemoryAuthStore();
    const fresh = async () => begun(store, google());
    const complete = async (fields: Record<string, string>, now = NOW) => {
      const { state, nonce, cookieHeader } = await fresh();
      return completeSignIn(store, google(), { params: params({ state, ...fields }), cookieHeader, now, settings, fetch: provider(nonce).fetch });
    };
    expect(await complete({ code: 'good-code' }, NOW + settings.oauthTtl)).toEqual({ ok: false, reason: 'state-expired' });
    expect(await complete({ error: 'access_denied' })).toEqual({ ok: false, reason: 'provider-error', error: 'access_denied' });
    expect(await complete({})).toEqual({ ok: false, reason: 'no-code' });
    expect(await complete({ code: 'bad-code' })).toEqual({ ok: false, reason: 'exchange-failed' });
    expect(store.accounts.size).toBe(0);
  });

  test('an ID token that fails validation signs nobody in', async () => {
    const store = new MemoryAuthStore();
    const attempt = async (over: Record<string, unknown>, lie?: (nonce: string) => string) => {
      const { state, nonce, cookieHeader } = await begun(store, google());
      const { fetch } = provider(lie ? lie(nonce) : nonce, over);
      return completeSignIn(store, google(), { params: params({ state, code: 'good-code' }), cookieHeader, now: NOW, settings, fetch });
    };
    expect(await attempt({ email_verified: false })).toEqual({ ok: false, reason: 'email-unverified' });
    expect(await attempt({ aud: 'someone-else' })).toEqual({ ok: false, reason: 'wrong-audience' });
    expect(await attempt({}, () => 'replayed-nonce')).toEqual({ ok: false, reason: 'nonce-mismatch' });
    expect(await attempt({ email: 'not an address' })).toEqual({ ok: false, reason: 'invalid-email' });
    expect(store.accounts.size).toBe(0);
    expect(store.identities.size).toBe(0);
  });

  test('Apple, start to finish: the posted form, a signed client secret, the relay address as the account’s', async () => {
    const store = new MemoryAuthStore();
    const appleKey = { teamId: 'TEAM123456', keyId: 'KEY1234567', privateKey: await importEs256PrivateKey(applePem) };
    const client = appleClient({ clientId: 'com.example.web', redirectUri: 'https://studio.example/account/apple', key: appleKey });
    const { state, nonce, cookieHeader } = await begun(store, client);
    const over = { iss: 'https://appleid.apple.com', aud: 'com.example.web', sub: 'apple-user-1', email: 'Relay1@privaterelay.example.com', email_verified: 'true', is_private_email: 'true' };
    const { fetch, calls } = provider(nonce, over, APPLE);

    // Apple posts a form; the route hands its text fields over as parameters.
    const form = new FormData();
    form.set('state', state);
    form.set('code', 'good-code');
    const posted = { get: (name: string) => (typeof form.get(name) === 'string' ? (form.get(name) as string) : null) };
    const result = await completeSignIn(store, client, { params: posted, cookieHeader, now: NOW, settings, fetch });
    if (!result.ok) throw new Error(result.reason);
    expect(result.account.email).toBe('relay1@privaterelay.example.com');

    const exchange = calls.find((c) => c.url === APPLE.tokenEndpoint)!;
    expect(exchange.body.has('code_verifier')).toBe(false);
    const secret = decodeJwt(exchange.body.get('client_secret')!)!;
    expect(secret.header).toEqual({ kid: 'KEY1234567', alg: 'ES256' });
    expect(secret.claims).toMatchObject({ iss: 'TEAM123456', sub: 'com.example.web', aud: 'https://appleid.apple.com' });
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, applePublic, secret.signature, utf8(secret.signed))).toBe(true);
  });
});

describe('one account per verified address', () => {
  const settingsLink = { purpose: { kind: 'sign-in' } as const, settings };

  test('Google first, then the e-mail link: the same account', async () => {
    const store = new MemoryAuthStore();
    const viaGoogle = await signInWithProvider(store, { provider: 'google', subject: 'g-1', email: 'Name@Example.com' }, NOW);
    expect(viaGoogle?.created).toBe(true);
    const link = await issueMagicLink(store, { email: 'name@example.com', now: NOW + 1, ...settingsLink });
    const viaLink = await redeem(store, link!.token, NOW + 2);
    if (!viaLink.ok) throw new Error(viaLink.reason);
    expect(viaLink.created).toBe(false);
    expect(viaLink.account.id).toBe(viaGoogle!.account.id);
    expect(store.accounts.size).toBe(1);
  });

  test('the e-mail link first, then Google and Apple: all attached to the one account', async () => {
    const store = new MemoryAuthStore();
    const link = await issueMagicLink(store, { email: 'name@example.com', now: NOW, ...settingsLink });
    const viaLink = await redeem(store, link!.token, NOW);
    if (!viaLink.ok) throw new Error(viaLink.reason);
    const viaGoogle = await signInWithProvider(store, { provider: 'google', subject: 'g-1', email: 'name@example.com' }, NOW + 1);
    const viaApple = await signInWithProvider(store, { provider: 'apple', subject: 'a-1', email: 'NAME@example.com' }, NOW + 2);
    expect(viaGoogle).toEqual({ account: viaLink.account, created: false });
    expect(viaApple).toEqual({ account: viaLink.account, created: false });
    expect((await store.identitiesOf(viaLink.account.id)).map((i) => i.provider).sort()).toEqual(['apple', 'google']);
  });

  test('a provider’s sign-in proves the address of an account an order made', async () => {
    const store = new MemoryAuthStore();
    await store.insertAccount({ id: 'a-1', email: 'name@example.com', createdAt: NOW, emailVerifiedAt: null });
    const signedIn = await signInWithProvider(store, { provider: 'google', subject: 'g-1', email: 'name@example.com' }, NOW + 9);
    expect(signedIn).toEqual({ account: { id: 'a-1', email: 'name@example.com', createdAt: NOW, emailVerifiedAt: NOW + 9 }, created: false });
  });

  test('a known provider user keeps their account when the provider reports a new address', async () => {
    const store = new MemoryAuthStore();
    const first = await signInWithProvider(store, { provider: 'google', subject: 'g-1', email: 'name@example.com' }, NOW);
    const other = await signInWithProvider(store, { provider: 'google', subject: 'g-2', email: 'other@example.com' }, NOW);
    const again = await signInWithProvider(store, { provider: 'google', subject: 'g-1', email: 'other@example.com' }, NOW + 1);
    expect(again?.account.id).toBe(first!.account.id);
    expect(again?.account.id).not.toBe(other!.account.id);
    expect(store.accounts.size).toBe(2);
  });

  test('the same subject at two providers is two users; an Apple relay address is its own account', async () => {
    const store = new MemoryAuthStore();
    const google1 = await signInWithProvider(store, { provider: 'google', subject: 'same', email: 'name@example.com' }, NOW);
    const apple1 = await signInWithProvider(store, { provider: 'apple', subject: 'same', email: 'relay1@privaterelay.example.com' }, NOW);
    expect(apple1?.created).toBe(true);
    expect(apple1?.account.id).not.toBe(google1!.account.id);
    expect(apple1?.account.email).toBe('relay1@privaterelay.example.com');
  });

  test('two first sign-ins at once make one account', async () => {
    const store = new MemoryAuthStore();
    const [a, b] = await Promise.all([
      signInWithProvider(store, { provider: 'google', subject: 'g-1', email: 'name@example.com' }, NOW),
      signInWithProvider(store, { provider: 'apple', subject: 'a-1', email: 'name@example.com' }, NOW),
    ]);
    expect(store.accounts.size).toBe(1);
    expect(a?.account.id).toBe(b!.account.id);
  });
});
