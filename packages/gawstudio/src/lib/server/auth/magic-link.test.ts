import { describe, expect, test } from 'bun:test';

import { accountForOrder, deleteAccount } from './accounts.ts';
import { hashToken } from './encoding.ts';
import { issueMagicLink, magicLinkUrl, recentLinkCount, redeem } from './magic-link.ts';
import { MemoryAuthStore } from './memory-store.ts';
import { createSession, verifySession } from './session.ts';
import { DEFAULT_AUTH_SETTINGS as settings } from './settings.ts';

const NOW = 1_800_000_000_000;
const signIn = { kind: 'sign-in' } as const;

async function issued(store: MemoryAuthStore, email = 'name@example.com', now = NOW) {
  const link = await issueMagicLink(store, { email, purpose: signIn, now, settings });
  if (!link) throw new Error('no link');
  return link;
}

describe('issuing a link', () => {
  test('only the hash is stored, and no account is made yet', async () => {
    const store = new MemoryAuthStore();
    const link = await issued(store, ' Name@Example.com ');
    expect(link.email).toBe('name@example.com');
    expect(link.expiresAt).toBe(NOW + settings.signInLinkTtl);
    expect([...store.links.keys()]).toEqual([await hashToken(link.token)]);
    expect(JSON.stringify([...store.links.values()])).not.toContain(link.token);
    expect(store.accounts.size).toBe(0);
  });

  test('what is not an address gets no link', async () => {
    const store = new MemoryAuthStore();
    expect(await issueMagicLink(store, { email: 'nobody', purpose: signIn, now: NOW, settings })).toBeUndefined();
    expect(store.links.size).toBe(0);
  });

  test('the caller sees how many links an address got within the window', async () => {
    const store = new MemoryAuthStore();
    expect(await recentLinkCount(store, 'name@example.com', NOW, settings)).toBe(0);
    expect((await issued(store)).issuedInWindow).toBe(1);
    expect((await issued(store, 'NAME@example.com', NOW + 1000)).issuedInWindow).toBe(2);
    expect((await issued(store, 'other@example.com', NOW + 2000)).issuedInWindow).toBe(1);
    expect(await recentLinkCount(store, 'name@example.com', NOW + 3000, settings)).toBe(2);
    expect(await recentLinkCount(store, 'name@example.com', NOW + 1000 + settings.linkCountWindow, settings)).toBe(1);
    expect((await issued(store, 'name@example.com', NOW + 2 * settings.linkCountWindow)).issuedInWindow).toBe(1);
  });

  test('the link carries the token as a parameter', async () => {
    const url = new URL(magicLinkUrl('https://studio.example/account/link', 'abc'));
    expect(url.origin + url.pathname).toBe('https://studio.example/account/link');
    expect(url.searchParams.get('token')).toBe('abc');
  });
});

describe('redeeming a link', () => {
  test('the first use makes the account, verified', async () => {
    const store = new MemoryAuthStore();
    const link = await issued(store);
    const result = await redeem(store, link.token, NOW + 60_000);
    if (!result.ok) throw new Error(result.reason);
    expect(result.created).toBe(true);
    expect(result.purpose).toEqual(signIn);
    expect(result.account).toMatchObject({ email: 'name@example.com', createdAt: NOW + 60_000, emailVerifiedAt: NOW + 60_000 });
  });

  test('a token works once', async () => {
    const store = new MemoryAuthStore();
    const link = await issued(store);
    expect((await redeem(store, link.token, NOW)).ok).toBe(true);
    expect(await redeem(store, link.token, NOW + 1)).toEqual({ ok: false, reason: 'used' });
    expect(store.accounts.size).toBe(1);
  });

  test('of two simultaneous uses, one wins', async () => {
    const store = new MemoryAuthStore();
    const link = await issued(store);
    const results = await Promise.all([redeem(store, link.token, NOW), redeem(store, link.token, NOW)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: 'used' });
  });

  test('a token expires, to the millisecond', async () => {
    const store = new MemoryAuthStore();
    const link = await issued(store);
    expect(await redeem(store, link.token, link.expiresAt)).toEqual({ ok: false, reason: 'expired' });
    expect(store.accounts.size).toBe(0);
    // Expiry did not spend it: a moment earlier it still works.
    expect((await redeem(store, link.token, link.expiresAt - 1)).ok).toBe(true);
  });

  test('a tampered, truncated or invented token is unknown', async () => {
    const store = new MemoryAuthStore();
    const { token } = await issued(store);
    const flipped = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
    for (const bad of [flipped, token.slice(0, -1), `${token}A`, '', 'not a token', `${token}\n`])
      expect(await redeem(store, bad, NOW)).toEqual({ ok: false, reason: 'unknown' });
    expect((await redeem(store, token, NOW)).ok).toBe(true);
  });

  test('a second link for the address signs in to the same account', async () => {
    const store = new MemoryAuthStore();
    const first = await redeem(store, (await issued(store)).token, NOW);
    const second = await redeem(store, (await issued(store, 'NAME@example.com')).token, NOW + 5);
    if (!first.ok || !second.ok) throw new Error('not redeemed');
    expect(second.created).toBe(false);
    expect(second.account.id).toBe(first.account.id);
    expect(second.account.emailVerifiedAt).toBe(NOW);
  });
});

describe('ordering without signing in', () => {
  test('the account exists after payment, and the confirmation link signs in to the order', async () => {
    const store = new MemoryAuthStore();
    const paid = await accountForOrder(store, 'Buyer@example.com', NOW);
    expect(paid?.created).toBe(true);
    expect(paid?.account.emailVerifiedAt).toBeNull();

    const purpose = { kind: 'order', orderId: 'order-1' } as const;
    const link = await issueMagicLink(store, { email: 'buyer@example.com', purpose, now: NOW, settings });
    expect(link?.expiresAt).toBe(NOW + settings.orderLinkTtl);
    const result = await redeem(store, link!.token, NOW + settings.signInLinkTtl + 1);
    if (!result.ok) throw new Error(result.reason);
    expect(result.purpose).toEqual(purpose);
    expect(result.created).toBe(false);
    expect(result.account.id).toBe(paid!.account.id);
    expect(result.account.emailVerifiedAt).toBe(NOW + settings.signInLinkTtl + 1);
  });

  test('an order needs an address', async () => {
    expect(await accountForOrder(new MemoryAuthStore(), 'nobody', NOW)).toBeUndefined();
  });
});

describe('deleting an account', () => {
  test('erases what is ours and names what is the caller’s', async () => {
    const store = new MemoryAuthStore();
    const result = await redeem(store, (await issued(store)).token, NOW);
    if (!result.ok) throw new Error(result.reason);
    const { account } = result;
    const { token } = await createSession(store, account.id, NOW, settings);
    await store.insertIdentity({ provider: 'google', subject: 'g-1', accountId: account.id, createdAt: NOW });
    const pending = await issued(store, 'name@example.com', NOW + 1);
    const other = await redeem(store, (await issued(store, 'other@example.com')).token, NOW);

    const plan = await deleteAccount(store, account.id);
    expect(plan).toEqual({
      accountId: account.id,
      email: 'name@example.com',
      erased: ['sessions', 'magic-links', 'identities', 'account'],
      erase: ['bookings', 'files'],
      anonymise: ['orders', 'invoices'],
      identities: [{ provider: 'google', subject: 'g-1' }],
    });
    expect(await verifySession(store, token, NOW, settings)).toEqual({ ok: false, reason: 'unknown' });
    // A link still in the mailbox must not bring the account back.
    expect(await redeem(store, pending.token, NOW + 2)).toEqual({ ok: false, reason: 'unknown' });
    expect(await store.identity('google', 'g-1')).toBeUndefined();
    expect([...store.accounts.values()].map((a) => a.email)).toEqual(['other@example.com']);
    expect(other.ok).toBe(true);
  });

  test('an unknown account has nothing to delete', async () => {
    expect(await deleteAccount(new MemoryAuthStore(), 'nobody')).toBeUndefined();
  });
});
