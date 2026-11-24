import { describe, expect, test } from 'bun:test';

import { ensureAccount } from './accounts.ts';
import {
  clearCookie,
  clearSessionCookie,
  localPath,
  readCookie,
  readSessionCookie,
  serializeCookie,
  SESSION_COOKIE,
  sessionCookie,
} from './cookie.ts';
import { hashToken } from './encoding.ts';
import { MemoryAuthStore } from './memory-store.ts';
import { createSession, revokeAllSessions, revokeSession, rotateSession, verifySession } from './session.ts';
import { DEFAULT_AUTH_SETTINGS as settings } from './settings.ts';

const NOW = 1_800_000_000_000;

async function signedIn() {
  const store = new MemoryAuthStore();
  const { account } = await ensureAccount(store, 'name@example.com', NOW, true);
  const started = await createSession(store, account.id, NOW, settings);
  return { store, account, ...started };
}

describe('a session', () => {
  test('is an opaque id whose hash alone is stored', async () => {
    const { store, token, session, account } = await signedIn();
    expect(session.idHash).toBe(await hashToken(token));
    expect(JSON.stringify([...store.sessions])).not.toContain(token);
    expect(session.expiresAt).toBe(NOW + settings.sessionAbsoluteTtl);
    const verified = await verifySession(store, token, NOW + 1000, settings);
    if (!verified.ok) throw new Error(verified.reason);
    expect(verified.account).toEqual(account);
  });

  test('an unknown or malformed id is no session', async () => {
    const { store, token } = await signedIn();
    const flipped = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
    for (const bad of [flipped, '', 'x', token.slice(1)])
      expect(await verifySession(store, bad, NOW, settings)).toEqual({ ok: false, reason: 'unknown' });
  });

  test('ends when idle for too long, and is removed', async () => {
    const { store, token } = await signedIn();
    expect((await verifySession(store, token, NOW + settings.sessionIdleTtl - 1, settings)).ok).toBe(true);
    const later = NOW + settings.sessionIdleTtl - 1 + settings.sessionIdleTtl;
    expect(await verifySession(store, token, later, settings)).toEqual({ ok: false, reason: 'idle' });
    expect(store.sessions.size).toBe(0);
    expect(await verifySession(store, token, later, settings)).toEqual({ ok: false, reason: 'unknown' });
  });

  test('use keeps it alive, but not past the absolute end', async () => {
    const { store, token, session } = await signedIn();
    const step = settings.sessionIdleTtl - 1;
    let now = NOW;
    while (now + step < session.expiresAt) {
      now += step;
      expect((await verifySession(store, token, now, settings)).ok).toBe(true);
    }
    expect((await verifySession(store, token, session.expiresAt - 1, settings)).ok).toBe(true);
    expect(await verifySession(store, token, session.expiresAt, settings)).toEqual({ ok: false, reason: 'expired' });
  });

  test('its last use is written at most once per interval', async () => {
    const { store, token, session } = await signedIn();
    await verifySession(store, token, NOW + settings.sessionTouchInterval - 1, settings);
    expect(store.sessions.get(session.idHash)?.lastSeenAt).toBe(NOW);
    const at = NOW + settings.sessionTouchInterval;
    const verified = await verifySession(store, token, at, settings);
    expect(store.sessions.get(session.idHash)?.lastSeenAt).toBe(at);
    expect(verified.ok && verified.session.lastSeenAt).toBe(at);
  });

  test('revoking signs out this browser, or all of them', async () => {
    const { store, token, account } = await signedIn();
    const second = await createSession(store, account.id, NOW, settings);
    const third = await createSession(store, account.id, NOW, settings);
    await revokeSession(store, token);
    expect((await verifySession(store, token, NOW, settings)).ok).toBe(false);
    expect((await verifySession(store, second.token, NOW, settings)).ok).toBe(true);
    await revokeAllSessions(store, account.id);
    expect((await verifySession(store, second.token, NOW, settings)).ok).toBe(false);
    expect((await verifySession(store, third.token, NOW, settings)).ok).toBe(false);
  });

  test('a session whose account is gone is no session', async () => {
    const { store, token, account } = await signedIn();
    await store.deleteAccount(account.id);
    expect(await verifySession(store, token, NOW, settings)).toEqual({ ok: false, reason: 'unknown' });
    expect(store.sessions.size).toBe(0);
  });

  test('rotation changes the id and keeps the absolute end', async () => {
    const { store, token, session } = await signedIn();
    const at = NOW + 3_600_000;
    const rotated = await rotateSession(store, token, at, settings);
    expect(rotated?.token).not.toBe(token);
    expect(rotated?.session).toMatchObject({ accountId: session.accountId, createdAt: NOW, lastSeenAt: at, expiresAt: session.expiresAt });
    expect(await verifySession(store, token, at, settings)).toEqual({ ok: false, reason: 'unknown' });
    expect((await verifySession(store, rotated!.token, at, settings)).ok).toBe(true);
    // The old id cannot be rotated again, and an ended session cannot be rotated back to life.
    expect(await rotateSession(store, token, at, settings)).toBeUndefined();
    expect(await rotateSession(store, rotated!.token, session.expiresAt, settings)).toBeUndefined();
    expect(store.sessions.size).toBe(0);
  });
});

describe('cookies', () => {
  test('the session cookie is HttpOnly, Secure, Lax, host-only and site-wide', async () => {
    const { token, session } = await signedIn();
    const header = sessionCookie(token, session.expiresAt, NOW);
    expect(header).toBe(`__Host-session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${settings.sessionAbsoluteTtl / 1000}`);
    expect(SESSION_COOKIE.startsWith('__Host-')).toBe(true);
    expect(header).not.toMatch(/domain/i);
  });

  test('round trip: what is set is what is read, and verifies', async () => {
    const { store, token, session } = await signedIn();
    const pair = sessionCookie(token, session.expiresAt, NOW).split(';')[0];
    const read = readSessionCookie(`theme=dark; ${pair}; lang=de`);
    expect(read).toBe(token);
    expect((await verifySession(store, read!, NOW, settings)).ok).toBe(true);
  });

  test('reading: absent, empty and look-alike names', () => {
    expect(readCookie(null, 'a')).toBeUndefined();
    expect(readCookie('', 'a')).toBeUndefined();
    expect(readCookie('a=', 'a')).toBeUndefined();
    expect(readCookie('aa=1; xa=2', 'a')).toBeUndefined();
    expect(readCookie('aa=1;a=x=y', 'a')).toBe('x=y');
    expect(readSessionCookie('session=plain')).toBeUndefined();
  });

  test('clearing keeps the attributes and ends the cookie', () => {
    expect(clearSessionCookie()).toBe('__Host-session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
    expect(clearCookie('__Host-x', { sameSite: 'None' })).toBe('__Host-x=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0');
  });

  test('a value that could add attributes is refused', () => {
    expect(() => serializeCookie('__Host-x', 'a; Domain=example.com')).toThrow(TypeError);
    expect(() => serializeCookie('__Host-x', 'a\r\nSet-Cookie: b=c')).toThrow(TypeError);
  });

  test('the way back after signing in stays on this site', () => {
    expect(localPath('/account/orders/1?x=1')).toBe('/account/orders/1?x=1');
    for (const bad of [null, undefined, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'account', '/a\nb'])
      expect(localPath(bad, '/account')).toBe('/account');
  });
});
