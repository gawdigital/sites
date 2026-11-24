// The linking rule and the deletion: one account per verified address, with Google and Apple users attached to
// it; and, when the customer asks to be forgotten, what goes here and what the caller must see to.
import { normaliseEmail } from './email.ts';
import { randomId } from './encoding.ts';
import type { Account, AuthStore, Identity, ProviderId } from './store.ts';

export interface Ensured {
  account: Account;
  /** Whether this call made the account. */
  created: boolean;
}

/**
 * The account of an address, made if there is none: the one way accounts come to be. `verified` says the
 * address has just been proved (a link redeemed, a provider's `email_verified`); an order paid with an address
 * calls this with `false`, and the account then waits for its confirmation link to prove the mailbox.
 *
 * `email` must be normalised already (`normaliseEmail`).
 */
export async function ensureAccount(store: AuthStore, email: string, now: number, verified: boolean): Promise<Ensured> {
  const existing = await store.accountByEmail(email);
  if (existing) return { account: await withVerified(store, existing, now, verified), created: false };
  const account: Account = { id: randomId(), email, createdAt: now, emailVerifiedAt: verified ? now : null };
  if (await store.insertAccount(account)) return { account, created: true };
  // Lost a race for the address: the other request's account is the account.
  const winner = await store.accountByEmail(email);
  if (!winner) throw new Error('auth: the account could neither be inserted nor found');
  return { account: await withVerified(store, winner, now, verified), created: false };
}

async function withVerified(store: AuthStore, account: Account, now: number, verified: boolean): Promise<Account> {
  if (!verified || account.emailVerifiedAt !== null) return account;
  await store.markEmailVerified(account.id, now);
  return { ...account, emailVerifiedAt: now };
}

/** The account for an order paid without signing in: exists from now on, unverified until its link is used. */
export async function accountForOrder(store: AuthStore, email: string, now: number): Promise<Ensured | undefined> {
  const normalised = normaliseEmail(email);
  return normalised === undefined ? undefined : ensureAccount(store, normalised, now, false);
}

/** A provider's user as its validated ID token describes them: the address is one the provider verified. */
export interface ProviderUser {
  provider: ProviderId;
  subject: string;
  email: string;
}

/**
 * Signs a provider's user in to their account.
 *
 * A user seen before (provider and `sub`) gets the account they are attached to, whatever address the provider
 * reports today: the `sub` is the identity, and an address changed at Google does not move the account. A user
 * not seen before joins the account of their verified address, which is made if needed; so Google, Apple and
 * the e-mail link with one address are one account. Only call this with an address the provider has verified
 * (`verifyIdToken` refuses the others): joining by an unverified address would hand accounts over.
 */
export async function signInWithProvider(store: AuthStore, user: ProviderUser, now: number): Promise<Ensured | undefined> {
  const known = await store.identity(user.provider, user.subject);
  const attached = known && (await store.accountById(known.accountId));
  if (attached) return { account: attached, created: false };

  const email = normaliseEmail(user.email);
  if (email === undefined) return undefined;
  const ensured = await ensureAccount(store, email, now, true);
  const identity: Identity = { provider: user.provider, subject: user.subject, accountId: ensured.account.id, createdAt: now };
  await store.insertIdentity(identity);
  return ensured;
}

/**
 * What a deletion leaves to the caller. This module has erased its own records; the rest is the caller's data,
 * keyed by `accountId` and `email`.
 */
export interface DeletionPlan {
  accountId: string;
  /** The address the erased account had: the key to anything stored by address (order forms, mail logs). */
  email: string;
  /** Erased here, already. */
  erased: readonly ['sessions', 'magic-links', 'identities', 'account'];
  /** The caller erases these outright: nothing obliges anyone to keep them. */
  erase: readonly ['bookings', 'files'];
  /**
   * The caller keeps these but cuts them loose from the person, as far as the law allows: accounting records
   * usually have to be kept for a statutory period. Which fields may go is the owner's and the accountant's
   * decision, not this module's.
   */
  anonymise: readonly ['orders', 'invoices'];
  /** The provider users that were attached: nothing of theirs is stored (no provider tokens are kept). */
  identities: readonly Pick<Identity, 'provider' | 'subject'>[];
}

/**
 * Deletes the account (GDPR erasure): signs it out everywhere, voids its unused links (an old confirmation
 * e-mail must not bring the account back), detaches Google and Apple, removes the account, and returns what
 * the caller still has to erase or anonymise. `undefined` when there is no such account.
 */
export async function deleteAccount(store: AuthStore, accountId: string): Promise<DeletionPlan | undefined> {
  const account = await store.accountById(accountId);
  if (!account) return undefined;
  const identities = (await store.identitiesOf(accountId)).map(({ provider, subject }) => ({ provider, subject }));
  await store.deleteSessionsOf(accountId);
  await store.deleteMagicLinksFor(account.email);
  await store.deleteIdentitiesOf(accountId);
  await store.deleteAccount(accountId);
  return {
    accountId,
    email: account.email,
    erased: ['sessions', 'magic-links', 'identities', 'account'],
    erase: ['bookings', 'files'],
    anonymise: ['orders', 'invoices'],
    identities,
  };
}
