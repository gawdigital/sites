import { describe, expect, test } from 'bun:test';

import {
  accountForOrder,
  beginSignIn,
  completeSignIn,
  createSession,
  DEFAULT_AUTH_SETTINGS as settings,
  deleteAccount,
  ensureAccount,
  googleClient,
  hashToken,
  issueMagicLink,
  MemoryAuthStore,
  OAUTH_COOKIE,
  recentLinkCount,
  redeem,
  revokeAllSessions,
  rotateSession,
  signInWithProvider,
  verifySession,
} from '../auth/index.ts';
import type { Account, AuthStore, MagicLink, OAuthTransaction, Session } from '../auth/index.ts';
import { D1AuthStore } from './auth-store.ts';
import { memoryD1 } from './testing.ts';
import type { MemoryD1 } from './testing.ts';

const NOW = 1_800_000_000_000;
const EMAIL = 'name@example.com';
const signIn = { kind: 'sign-in' } as const;

const anAccount = (over: Partial<Account> = {}): Account => ({ id: 'acc-1', email: EMAIL, createdAt: NOW, emailVerifiedAt: null, ...over });
const aLink = (over: Partial<MagicLink> = {}): MagicLink => ({ tokenHash: 'hash-1', email: EMAIL, purpose: signIn, createdAt: NOW, expiresAt: NOW + 1000, usedAt: null, ...over });
const aSession = (over: Partial<Session> = {}): Session => ({ idHash: 'sid-1', accountId: 'acc-1', createdAt: NOW, lastSeenAt: NOW, expiresAt: NOW + 1000, ...over });
const aTransaction = (over: Partial<OAuthTransaction> = {}): OAuthTransaction => ({
  stateHash: 'state-1',
  provider: 'google',
  nonce: 'nonce',
  codeVerifier: 'verifier',
  returnTo: '/account',
  expiresAt: NOW + 1000,
  ...over,
});

function d1Store(): { store: D1AuthStore; db: MemoryD1 } {
  const db = memoryD1();
  return { store: new D1AuthStore(db), db };
}

// The contract of `AuthStore`, run on the reference implementation and on D1 alike: what passes on one must pass
// on the other.
const STORES: [string, () => AuthStore][] = [
  ['MemoryAuthStore', () => new MemoryAuthStore()],
  ['D1AuthStore', () => d1Store().store],
];

for (const [name, make] of STORES) {
  describe(`the store contract: ${name}`, () => {
    test('an account is found by id and by address, as it was stored', async () => {
      const store = make();
      expect(await store.accountById('acc-1')).toBeUndefined();
      expect(await store.accountByEmail(EMAIL)).toBeUndefined();
      expect(await store.insertAccount(anAccount())).toBe(true);
      expect(await store.accountById('acc-1')).toEqual(anAccount());
      expect(await store.accountByEmail(EMAIL)).toEqual(anAccount());
    });

    test('an address has one account: the second insert is refused and changes nothing', async () => {
      const store = make();
      expect(await store.insertAccount(anAccount())).toBe(true);
      expect(await store.insertAccount(anAccount({ id: 'acc-2', createdAt: NOW + 1 }))).toBe(false);
      expect(await store.insertAccount(anAccount({ email: 'other@example.com' }))).toBe(false);
      expect(await store.accountByEmail(EMAIL)).toEqual(anAccount());
      expect(await store.accountById('acc-2')).toBeUndefined();
    });

    test('an address is verified once: the first time stays', async () => {
      const store = make();
      await store.insertAccount(anAccount());
      await store.markEmailVerified('acc-1', NOW + 5);
      await store.markEmailVerified('acc-1', NOW + 9);
      await store.markEmailVerified('nobody', NOW);
      expect((await store.accountById('acc-1'))?.emailVerifiedAt).toBe(NOW + 5);
    });

    test('a provider user is attached to one account only', async () => {
      const store = make();
      await store.insertAccount(anAccount());
      await store.insertAccount(anAccount({ id: 'acc-2', email: 'other@example.com' }));
      await store.insertIdentity({ provider: 'google', subject: 'sub-1', accountId: 'acc-1', createdAt: NOW });
      await store.insertIdentity({ provider: 'google', subject: 'sub-1', accountId: 'acc-2', createdAt: NOW + 1 });
      await store.insertIdentity({ provider: 'apple', subject: 'sub-1', accountId: 'acc-1', createdAt: NOW + 2 });
      expect(await store.identity('google', 'sub-1')).toEqual({ provider: 'google', subject: 'sub-1', accountId: 'acc-1', createdAt: NOW });
      expect((await store.identitiesOf('acc-1')).map((i) => i.provider)).toEqual(['google', 'apple']);
      expect(await store.identitiesOf('acc-2')).toEqual([]);
      await store.deleteIdentitiesOf('acc-1');
      expect(await store.identity('apple', 'sub-1')).toBeUndefined();
    });

    test('a link keeps its purpose, and is consumed by one caller only', async () => {
      const store = make();
      const order = aLink({ tokenHash: 'hash-2', purpose: { kind: 'order', orderId: 'ord-1' } });
      await store.insertMagicLink(aLink());
      await store.insertMagicLink(order);
      expect(await store.magicLinkByHash('hash-1')).toEqual(aLink());
      expect(await store.magicLinkByHash('hash-2')).toEqual(order);
      expect(await store.magicLinkByHash('hash-3')).toBeUndefined();

      const results = await Promise.all([1, 2, 3, 4].map((i) => store.consumeMagicLink('hash-1', NOW + i)));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await store.magicLinkByHash('hash-1'))?.usedAt).toBe(NOW + 1 + results.indexOf(true));
      expect(await store.consumeMagicLink('hash-3', NOW)).toBe(false);
    });

    test('links are counted per address from a time on, and deleted per address', async () => {
      const store = make();
      await store.insertMagicLink(aLink({ tokenHash: 'a', createdAt: NOW }));
      await store.insertMagicLink(aLink({ tokenHash: 'b', createdAt: NOW + 10 }));
      await store.insertMagicLink(aLink({ tokenHash: 'c', email: 'other@example.com', createdAt: NOW + 10 }));
      expect(await store.countMagicLinks(EMAIL, NOW)).toBe(2);
      expect(await store.countMagicLinks(EMAIL, NOW + 10)).toBe(1);
      expect(await store.countMagicLinks(EMAIL, NOW + 11)).toBe(0);
      await store.deleteMagicLinksFor(EMAIL);
      expect(await store.countMagicLinks(EMAIL, 0)).toBe(0);
      expect(await store.countMagicLinks('other@example.com', 0)).toBe(1);
    });

    test('a session is read, touched, and deleted by one caller only', async () => {
      const store = make();
      await store.insertAccount(anAccount());
      await store.insertSession(aSession());
      await store.insertSession(aSession({ idHash: 'sid-2' }));
      expect(await store.sessionByHash('sid-1')).toEqual(aSession());
      await store.touchSession('sid-1', NOW + 7);
      expect((await store.sessionByHash('sid-1'))?.lastSeenAt).toBe(NOW + 7);

      const results = await Promise.all([1, 2, 3].map(() => store.deleteSession('sid-1')));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await store.sessionByHash('sid-1')).toBeUndefined();
      await store.deleteSessionsOf('acc-1');
      expect(await store.sessionByHash('sid-2')).toBeUndefined();
    });

    test('a state is taken once, with everything the callback needs', async () => {
      const store = make();
      await store.insertOAuthTransaction(aTransaction());
      await store.insertOAuthTransaction(aTransaction({ stateHash: 'state-2', provider: 'apple', codeVerifier: null }));
      const taken = await Promise.all([1, 2, 3].map(() => store.takeOAuthTransaction('state-1')));
      expect(taken.filter(Boolean)).toEqual([aTransaction()]);
      expect(await store.takeOAuthTransaction('state-2')).toEqual(aTransaction({ stateHash: 'state-2', provider: 'apple', codeVerifier: null }));
      expect(await store.takeOAuthTransaction('state-3')).toBeUndefined();
    });

    test('what the store hands out is a copy', async () => {
      const store = make();
      await store.insertAccount(anAccount());
      const read = await store.accountById('acc-1');
      read!.email = 'changed@example.com';
      expect((await store.accountById('acc-1'))?.email).toBe(EMAIL);
    });
  });
}

describe('the accounts on D1', () => {
  test('a link signs in once: the second use is refused, and so is one of two at the same moment', async () => {
    const { store } = d1Store();
    const first = (await issueMagicLink(store, { email: ' Name@Example.com ', purpose: signIn, now: NOW, settings }))!;
    const redeemed = await redeem(store, first.token, NOW + 1000);
    expect(redeemed).toMatchObject({ ok: true, created: true, purpose: signIn, account: { email: EMAIL, emailVerifiedAt: NOW + 1000 } });
    expect(await redeem(store, first.token, NOW + 2000)).toEqual({ ok: false, reason: 'used' });

    const second = (await issueMagicLink(store, { email: EMAIL, purpose: { kind: 'order', orderId: 'ord-1' }, now: NOW, settings }))!;
    const both = await Promise.all([redeem(store, second.token, NOW + 3000), redeem(store, second.token, NOW + 3000)]);
    expect(both.map((r) => r.ok).sort()).toEqual([false, true]);
    expect(both.find((r) => r.ok)).toMatchObject({ created: false, purpose: { kind: 'order', orderId: 'ord-1' } });
  });

  test('only the hash of a token is stored, and an expired or unknown link signs nobody in', async () => {
    const { store, db } = d1Store();
    const link = (await issueMagicLink(store, { email: EMAIL, purpose: signIn, now: NOW, settings }))!;
    const rows = db.sqlite.query('SELECT * FROM magic_links').all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ token_hash: await hashToken(link.token), purpose: 'sign-in', order_id: null, used_at: null });
    expect(JSON.stringify(rows)).not.toContain(link.token);

    expect(await redeem(store, link.token, NOW + settings.signInLinkTtl)).toEqual({ ok: false, reason: 'expired' });
    expect(await redeem(store, `${link.token.slice(0, -1)}${link.token.endsWith('A') ? 'B' : 'A'}`, NOW)).toEqual({ ok: false, reason: 'unknown' });
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM accounts').get()).toEqual({ n: 0 });
  });

  test('issued links are counted over the window', async () => {
    const { store } = d1Store();
    const issue = (now: number) => issueMagicLink(store, { email: EMAIL, purpose: signIn, now, settings });
    expect((await issue(NOW))?.issuedInWindow).toBe(1);
    expect((await issue(NOW + 1000))?.issuedInWindow).toBe(2);
    expect(await recentLinkCount(store, 'NAME@example.com', NOW + 1000 + settings.linkCountWindow, settings)).toBe(1);
  });

  test('two requests racing to make the account of one address end with one account', async () => {
    const { store, db } = d1Store();
    const made = await Promise.all([ensureAccount(store, EMAIL, NOW, false), ensureAccount(store, EMAIL, NOW, true), ensureAccount(store, EMAIL, NOW, false)]);
    expect(made.filter((m) => m.created)).toHaveLength(1);
    expect(new Set(made.map((m) => m.account.id)).size).toBe(1);
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM accounts').get()).toEqual({ n: 1 });
    expect((await store.accountByEmail(EMAIL))?.emailVerifiedAt).toBe(NOW);
  });

  test('the unique address is the database’s rule, not only the store’s', () => {
    const { db } = d1Store();
    db.sqlite.run("INSERT INTO accounts (id, email, created_at) VALUES ('a', 'name@example.com', 1)");
    expect(() => db.sqlite.run("INSERT INTO accounts (id, email, created_at) VALUES ('b', 'name@example.com', 1)")).toThrow(/UNIQUE/);
    db.sqlite.run("INSERT INTO identities (provider, subject, account_id, created_at) VALUES ('google', 's', 'a', 1)");
    expect(() => db.sqlite.run("INSERT INTO identities (provider, subject, account_id, created_at) VALUES ('google', 's', 'a', 2)")).toThrow(/UNIQUE/);
    expect(() => db.sqlite.run("INSERT INTO magic_links (token_hash, email, purpose, created_at, expires_at) VALUES ('h', 'name@example.com', 'order', 1, 2)")).toThrow(/CHECK/);
  });

  test('Google, Apple and the link with one address are one account; a known user keeps theirs', async () => {
    const { store } = d1Store();
    const paid = (await accountForOrder(store, EMAIL, NOW))!;
    expect(paid.account.emailVerifiedAt).toBeNull();
    const google = (await signInWithProvider(store, { provider: 'google', subject: 'g-1', email: 'Name@Example.com' }, NOW + 1))!;
    const apple = (await signInWithProvider(store, { provider: 'apple', subject: 'a-1', email: EMAIL }, NOW + 2))!;
    expect([google.account.id, apple.account.id]).toEqual([paid.account.id, paid.account.id]);
    expect(google).toMatchObject({ created: false, account: { emailVerifiedAt: NOW + 1 } });
    const moved = (await signInWithProvider(store, { provider: 'google', subject: 'g-1', email: 'moved@example.com' }, NOW + 3))!;
    expect(moved.account.id).toBe(paid.account.id);
    expect(await store.accountByEmail('moved@example.com')).toBeUndefined();
  });

  test('sessions verify, idle out, rotate once and are revoked together', async () => {
    const { store } = d1Store();
    const { account } = await ensureAccount(store, EMAIL, NOW, true);
    const started = await createSession(store, account.id, NOW, settings);
    expect(await verifySession(store, started.token, NOW + 1000, settings)).toMatchObject({ ok: true, account: { id: account.id } });

    const later = NOW + settings.sessionTouchInterval;
    expect(await verifySession(store, started.token, later, settings)).toMatchObject({ ok: true, session: { lastSeenAt: later } });
    expect((await store.sessionByHash(started.session.idHash))?.lastSeenAt).toBe(later);

    const rotated = await Promise.all([rotateSession(store, started.token, later, settings), rotateSession(store, started.token, later, settings)]);
    const [fresh] = rotated.filter((r) => r !== undefined);
    expect(rotated.filter((r) => r !== undefined)).toHaveLength(1);
    expect(await verifySession(store, started.token, later, settings)).toEqual({ ok: false, reason: 'unknown' });
    expect(fresh!.session.expiresAt).toBe(started.session.expiresAt);

    expect(await verifySession(store, fresh!.token, later + settings.sessionIdleTtl, settings)).toEqual({ ok: false, reason: 'idle' });
    expect(await store.sessionByHash(fresh!.session.idHash)).toBeUndefined();

    const again = await createSession(store, account.id, NOW, settings);
    await revokeAllSessions(store, account.id);
    expect(await verifySession(store, again.token, NOW, settings)).toEqual({ ok: false, reason: 'unknown' });
  });

  test('a provider’s state completes one callback; the same callback again finds nothing', async () => {
    const { store, db } = d1Store();
    const client = googleClient({ clientId: 'client', clientSecret: 'secret', redirectUri: 'https://studio.example/account/google' });
    const start = await beginSignIn(store, client, { now: NOW, settings, returnTo: '/account/orders' });
    const state = new URL(start.url).searchParams.get('state')!;
    expect(db.sqlite.query('SELECT state_hash, provider, return_to FROM oauth_transactions').all()).toEqual([
      { state_hash: await hashToken(state), provider: 'google', return_to: '/account/orders' },
    ]);

    const callback = {
      params: new URLSearchParams({ state, error: 'access_denied' }),
      cookieHeader: `${OAUTH_COOKIE}=${state}`,
      now: NOW + 1000,
      settings,
      fetch: () => Promise.reject(new Error('no request is expected')),
    };
    expect(await completeSignIn(store, client, callback)).toEqual({ ok: false, reason: 'provider-error', error: 'access_denied' });
    expect(await completeSignIn(store, client, callback)).toEqual({ ok: false, reason: 'state-unknown' });
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM oauth_transactions').get()).toEqual({ n: 0 });
  });

  test('deleting an account erases its sessions, links and identities, and cuts its orders loose', async () => {
    const { store, db } = d1Store();
    const { account } = await ensureAccount(store, EMAIL, NOW, true);
    await signInWithProvider(store, { provider: 'google', subject: 'g-1', email: EMAIL }, NOW);
    const session = await createSession(store, account.id, NOW, settings);
    const link = (await issueMagicLink(store, { email: EMAIL, purpose: { kind: 'order', orderId: 'ord-1' }, now: NOW, settings }))!;
    db.sqlite.run(
      `INSERT INTO orders (id, account_id, email, flow, state, state_since, currency, prices_include_vat, vat_rate_bp, subtotal, vat, total, created_at)
       VALUES ('ord-1', ?, ?, 'classic', 'paid', 1, 'EUR', 0, 2100, 100, 21, 121, 1)`,
      [account.id, EMAIL],
    );

    const plan = await deleteAccount(store, account.id);
    expect(plan).toMatchObject({ accountId: account.id, email: EMAIL, identities: [{ provider: 'google', subject: 'g-1' }] });
    expect(await verifySession(store, session.token, NOW, settings)).toEqual({ ok: false, reason: 'unknown' });
    expect(await redeem(store, link.token, NOW)).toEqual({ ok: false, reason: 'unknown' });
    for (const table of ['accounts', 'identities', 'sessions', 'magic_links']) expect(db.sqlite.query(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    // The order stays (an accounting record) without its account; its address is the caller's to anonymise.
    expect(db.sqlite.query('SELECT account_id, email FROM orders').all()).toEqual([{ account_id: null, email: EMAIL }]);
  });

  test('the cascade alone erases what belongs to an account', async () => {
    const { store, db } = d1Store();
    const { account } = await ensureAccount(store, EMAIL, NOW, true);
    await signInWithProvider(store, { provider: 'apple', subject: 'a-1', email: EMAIL }, NOW);
    await createSession(store, account.id, NOW, settings);
    await store.deleteAccount(account.id);
    for (const table of ['identities', 'sessions']) expect(db.sqlite.query(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
  });

  test('nothing is stored for an account that does not exist, and nothing fails', async () => {
    const { store, db } = d1Store();
    const session = await createSession(store, 'nobody', NOW, settings);
    await store.insertIdentity({ provider: 'google', subject: 'g-1', accountId: 'nobody', createdAt: NOW });
    expect(await verifySession(store, session.token, NOW, settings)).toEqual({ ok: false, reason: 'unknown' });
    expect(await store.identity('google', 'g-1')).toBeUndefined();
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });

  test('a stored provider the code does not know is an error, not an identity', async () => {
    const { store, db } = d1Store();
    await store.insertAccount(anAccount());
    db.sqlite.run("INSERT INTO identities (provider, subject, account_id, created_at) VALUES ('github', 's', 'acc-1', 1)");
    await expect(store.identitiesOf('acc-1')).rejects.toThrow(/identities\.provider/);
  });

  test('housekeeping removes what can no longer be used, and keeps a link while it counts for the rate limit', async () => {
    const { store } = d1Store();
    await store.insertAccount(anAccount());
    const window = settings.linkCountWindow;
    await store.insertMagicLink(aLink({ tokenHash: 'old', createdAt: NOW - window - 1, expiresAt: NOW - 1 }));
    await store.insertMagicLink(aLink({ tokenHash: 'expired-but-counted', createdAt: NOW - 1000, expiresAt: NOW }));
    await store.insertMagicLink(aLink({ tokenHash: 'old-but-live', createdAt: NOW - window - 1, expiresAt: NOW + 1 }));
    await store.insertSession(aSession({ idHash: 'live', expiresAt: NOW + 1 }));
    await store.insertSession(aSession({ idHash: 'expired', expiresAt: NOW }));
    await store.insertSession(aSession({ idHash: 'idle', lastSeenAt: NOW - settings.sessionIdleTtl, expiresAt: NOW + 1 }));
    await store.insertOAuthTransaction(aTransaction({ stateHash: 'gone', expiresAt: NOW }));
    await store.insertOAuthTransaction(aTransaction({ stateHash: 'live', expiresAt: NOW + 1 }));

    expect(await store.purgeExpired(NOW, settings)).toEqual({ magicLinks: 1, sessions: 2, oauthTransactions: 1 });
    expect(await store.magicLinkByHash('old')).toBeUndefined();
    expect(await store.countMagicLinks(EMAIL, NOW - window)).toBe(1);
    expect(await store.sessionByHash('live')).toBeDefined();
    expect(await store.takeOAuthTransaction('live')).toBeDefined();
  });
});
