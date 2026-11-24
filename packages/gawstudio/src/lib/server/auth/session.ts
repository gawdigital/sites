// Sessions: an opaque random id in the cookie, its hash in the store. A session ends when unused for too long
// (idle), a fixed time after sign-in (absolute), or when revoked; nothing about the account is in the cookie.
import { hashToken, isToken, randomToken, timingSafeEqual } from './encoding.ts';
import type { AuthSettings } from './settings.ts';
import type { Account, AuthStore, Session } from './store.ts';

export interface StartedSession {
  /** The cookie's value (`sessionCookie`); not kept anywhere else. */
  token: string;
  session: Session;
}

export async function createSession(store: AuthStore, accountId: string, now: number, settings: AuthSettings): Promise<StartedSession> {
  return insert(store, { accountId, createdAt: now, lastSeenAt: now, expiresAt: now + settings.sessionAbsoluteTtl });
}

async function insert(store: AuthStore, fields: Omit<Session, 'idHash'>): Promise<StartedSession> {
  const token = randomToken();
  const session: Session = { idHash: await hashToken(token), ...fields };
  await store.insertSession(session);
  return { token, session };
}

export type SessionFailure = 'unknown' | 'idle' | 'expired';

export type VerifiedSession = { ok: true; session: Session; account: Account } | { ok: false; reason: SessionFailure };

/**
 * The session and account behind a cookie's value, or why there is none. A session past either limit is
 * removed; a live one has its last use noted (at most once per `sessionTouchInterval`).
 */
export async function verifySession(store: AuthStore, token: string, now: number, settings: AuthSettings): Promise<VerifiedSession> {
  const session = await find(store, token);
  if (!session) return { ok: false, reason: 'unknown' };
  const reason = ended(session, now, settings);
  if (reason) {
    await store.deleteSession(session.idHash);
    return { ok: false, reason };
  }
  const account = await store.accountById(session.accountId);
  if (!account) {
    await store.deleteSession(session.idHash);
    return { ok: false, reason: 'unknown' };
  }
  if (now - session.lastSeenAt < settings.sessionTouchInterval) return { ok: true, session, account };
  await store.touchSession(session.idHash, now);
  return { ok: true, session: { ...session, lastSeenAt: now }, account };
}

async function find(store: AuthStore, token: string): Promise<Session | undefined> {
  if (!isToken(token)) return undefined;
  const idHash = await hashToken(token);
  const session = await store.sessionByHash(idHash);
  return session && timingSafeEqual(session.idHash, idHash) ? session : undefined;
}

function ended(session: Session, now: number, settings: AuthSettings): SessionFailure | undefined {
  if (now >= session.expiresAt) return 'expired';
  if (now - session.lastSeenAt >= settings.sessionIdleTtl) return 'idle';
  return undefined;
}

/** Signs out: the cookie's value stops working. The caller also clears the cookie (`clearSessionCookie`). */
export async function revokeSession(store: AuthStore, token: string): Promise<void> {
  if (isToken(token)) await store.deleteSession(await hashToken(token));
}

/** Signs the account out everywhere. */
export async function revokeAllSessions(store: AuthStore, accountId: string): Promise<void> {
  await store.deleteSessionsOf(accountId);
}

/**
 * Replaces a live session's id: the old cookie value stops working, the new one carries on until the same
 * absolute end. For moments when the id should change hands (a change of privilege, a periodic refresh).
 * `undefined` when the session is not live; of two requests rotating one session, one wins.
 */
export async function rotateSession(store: AuthStore, token: string, now: number, settings: AuthSettings): Promise<StartedSession | undefined> {
  const session = await find(store, token);
  if (!session || !(await store.deleteSession(session.idHash)) || ended(session, now, settings)) return undefined;
  return insert(store, { accountId: session.accountId, createdAt: session.createdAt, lastSeenAt: now, expiresAt: session.expiresAt });
}
