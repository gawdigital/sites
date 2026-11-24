// Sign-in by a link in an e-mail: a random token that works once, for minutes. The e-mail carries the token,
// the store only its hash; redeeming it proves the mailbox, which is all an account is.
//
// For the caller's route: mail scanners follow links, so redeem on a POST (the link's page holds a form with
// one button, which needs no JavaScript), not on the GET itself, or a scanner spends the link before the
// customer does.
import { ensureAccount } from './accounts.ts';
import { normaliseEmail } from './email.ts';
import { hashToken, isToken, randomToken, timingSafeEqual } from './encoding.ts';
import type { AuthSettings } from './settings.ts';
import type { Account, AuthStore, LinkPurpose } from './store.ts';

export interface IssueRequest {
  email: string;
  purpose: LinkPurpose;
  now: number;
  settings: AuthSettings;
}

/** What to send: the caller builds the URL (`magicLinkUrl`) and the e-mail. The token is not kept anywhere. */
export interface IssuedLink {
  token: string;
  /** The normalised address to send to. */
  email: string;
  purpose: LinkPurpose;
  expiresAt: number;
  /** Links issued for this address within `settings.linkCountWindow`, this one included. */
  issuedInWindow: number;
}

/** Links issued for the address in the current window: ask before issuing to refuse, the limit being yours. */
export async function recentLinkCount(store: AuthStore, email: string, now: number, settings: AuthSettings): Promise<number> {
  const normalised = normaliseEmail(email);
  return normalised === undefined ? 0 : store.countMagicLinks(normalised, now - settings.linkCountWindow);
}

/**
 * Issues a link for the address; `undefined` when it is not an address. No account is needed or made: the
 * account appears when the link is redeemed, so asking for a link reveals nothing about who has one.
 */
export async function issueMagicLink(store: AuthStore, request: IssueRequest): Promise<IssuedLink | undefined> {
  const { purpose, now, settings } = request;
  const email = normaliseEmail(request.email);
  if (email === undefined) return undefined;
  const token = randomToken();
  const ttl = purpose.kind === 'order' ? settings.orderLinkTtl : settings.signInLinkTtl;
  const expiresAt = now + ttl;
  await store.insertMagicLink({ tokenHash: await hashToken(token), email, purpose, createdAt: now, expiresAt, usedAt: null });
  const issuedInWindow = await store.countMagicLinks(email, now - settings.linkCountWindow);
  return { token, email, purpose, expiresAt, issuedInWindow };
}

/** The link to put in the e-mail: `page` is the site's redeeming page, absolute. */
export function magicLinkUrl(page: string | URL, token: string): string {
  const url = new URL(page);
  url.searchParams.set('token', token);
  return url.href;
}

export type RedeemFailure = 'unknown' | 'used' | 'expired';

export type Redeemed =
  | { ok: true; account: Account; created: boolean; purpose: LinkPurpose }
  | { ok: false; reason: RedeemFailure };

/**
 * Redeems a token: the account of its address (made on first use), signed in for the link's purpose, or why not.
 * A token works once; a second use, an expired one and one never issued (or altered) are told apart for the
 * page's wording only. The caller then starts a session (`createSession`).
 */
export async function redeem(store: AuthStore, token: string, now: number): Promise<Redeemed> {
  if (!isToken(token)) return { ok: false, reason: 'unknown' };
  const tokenHash = await hashToken(token);
  const link = await store.magicLinkByHash(tokenHash);
  // The store found it by the hash; comparing again in constant time keeps a lenient lookup (a collation, a
  // prefix index) from ever accepting a near miss.
  if (!link || !timingSafeEqual(link.tokenHash, tokenHash)) return { ok: false, reason: 'unknown' };
  if (link.usedAt !== null) return { ok: false, reason: 'used' };
  if (now >= link.expiresAt) return { ok: false, reason: 'expired' };
  if (!(await store.consumeMagicLink(tokenHash, now))) return { ok: false, reason: 'used' };
  const { account, created } = await ensureAccount(store, link.email, now, true);
  return { ok: true, account, created, purpose: link.purpose };
}
