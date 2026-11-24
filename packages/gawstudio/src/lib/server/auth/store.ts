// What the accounts keep, and the few operations they need from wherever it is kept. The database is the
// caller's: this is the contract, `memory-store.ts` the implementation the tests run on.

export type ProviderId = 'google' | 'apple';

/** One person: one verified address. Times are epoch milliseconds. */
export interface Account {
  id: string;
  /** Normalised (`normaliseEmail`), unique. For a customer hiding behind Apple, the relay address. */
  email: string;
  createdAt: number;
  /**
   * When the address was first proved: a link from its mailbox redeemed, or a provider vouching for it. `null`
   * for an account that so far exists only because an order was paid with that address.
   */
  emailVerifiedAt: number | null;
}

/** A Google or Apple user attached to an account, known by the provider's stable `sub`, never by address. */
export interface Identity {
  provider: ProviderId;
  subject: string;
  accountId: string;
  createdAt: number;
}

/** Why a link was sent: to sign in, or to sign in to one order from its confirmation e-mail. */
export type LinkPurpose = { kind: 'sign-in' } | { kind: 'order'; orderId: string };

export interface MagicLink {
  /** SHA-256 of the token; the token itself exists only in the e-mail. */
  tokenHash: string;
  email: string;
  purpose: LinkPurpose;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
}

export interface Session {
  /** SHA-256 of the cookie's value. */
  idHash: string;
  accountId: string;
  createdAt: number;
  lastSeenAt: number;
  /** Fixed at sign-in and kept through rotation. */
  expiresAt: number;
}

/** A sign-in under way at a provider: what the callback must match. */
export interface OAuthTransaction {
  /** SHA-256 of `state`. */
  stateHash: string;
  provider: ProviderId;
  nonce: string;
  /** PKCE's secret half; `null` for a provider without PKCE. */
  codeVerifier: string | null;
  /** The local path to go to once signed in. */
  returnTo: string;
  expiresAt: number;
}

export interface AuthStore {
  accountById(id: string): Promise<Account | undefined>;
  accountByEmail(email: string): Promise<Account | undefined>;
  /** Inserts unless the address is taken (a unique index): `false` then, and the caller reads the winner. */
  insertAccount(account: Account): Promise<boolean>;
  /** Sets `emailVerifiedAt` where it is still `null`. */
  markEmailVerified(accountId: string, at: number): Promise<void>;
  deleteAccount(accountId: string): Promise<void>;

  identity(provider: ProviderId, subject: string): Promise<Identity | undefined>;
  identitiesOf(accountId: string): Promise<Identity[]>;
  /** Inserts unless that provider user is already attached (unique on provider and subject). */
  insertIdentity(identity: Identity): Promise<void>;
  deleteIdentitiesOf(accountId: string): Promise<void>;

  insertMagicLink(link: MagicLink): Promise<void>;
  magicLinkByHash(tokenHash: string): Promise<MagicLink | undefined>;
  /**
   * Marks the link used if it is not yet, atomically (`UPDATE … WHERE used_at IS NULL`): `true` for the one
   * caller that got it. Single use rests on this.
   */
  consumeMagicLink(tokenHash: string, at: number): Promise<boolean>;
  /** How many links were issued for the address at or after `since`. */
  countMagicLinks(email: string, since: number): Promise<number>;
  deleteMagicLinksFor(email: string): Promise<void>;

  insertSession(session: Session): Promise<void>;
  sessionByHash(idHash: string): Promise<Session | undefined>;
  touchSession(idHash: string, at: number): Promise<void>;
  /** `true` when there was one to delete: a rotation is won by the one caller that removes the old session. */
  deleteSession(idHash: string): Promise<boolean>;
  deleteSessionsOf(accountId: string): Promise<void>;

  insertOAuthTransaction(transaction: OAuthTransaction): Promise<void>;
  /** Removes and returns the transaction, atomically (`DELETE … RETURNING`): a `state` works once. */
  takeOAuthTransaction(stateHash: string): Promise<OAuthTransaction | undefined>;
}
