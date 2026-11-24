// The accounts' store on D1: `AuthStore` (`../auth/store.ts`) in full, each operation one statement or one batch.
// Where the contract asks for atomicity it rests on a constraint or on a single statement, never on reading
// first and writing after:
// - one account per address: the UNIQUE index on `accounts.email` and an insert that does nothing on conflict;
// - a link works once: `UPDATE … WHERE used_at IS NULL`, won by the one request whose update changes a row;
// - a rotation is won once: `DELETE` of the session, won by the request whose delete removes a row;
// - a `state` works once: the row is read and deleted in one batch, which is one transaction, and counts only
//   for the request whose delete removed it. (The contract suggests `DELETE … RETURNING`; the batch needs
//   nothing beyond what D1 documents.)
//
// Two differences from `MemoryAuthStore`, both on purpose: an identity or a session for an account that does not
// exist is not stored (the foreign key would refuse it; the insert is written to do nothing instead of failing),
// and deleting an account takes its identities and sessions with it (ON DELETE CASCADE) and cuts its orders
// loose (ON DELETE SET NULL), whether or not the caller removed them first.
import type { Account, AuthStore, Identity, LinkPurpose, MagicLink, OAuthTransaction, ProviderId, Session } from '../auth/store.ts';
import { changesOf, oneOf, rowsOf } from './d1.ts';
import type { D1Like } from './d1.ts';

const PROVIDERS: readonly ProviderId[] = ['google', 'apple'];
const PURPOSES: readonly LinkPurpose['kind'][] = ['sign-in', 'order'];

interface AccountRow {
  id: string;
  email: string;
  created_at: number;
  email_verified_at: number | null;
}

interface IdentityRow {
  provider: string;
  subject: string;
  account_id: string;
  created_at: number;
}

interface MagicLinkRow {
  token_hash: string;
  email: string;
  purpose: string;
  order_id: string | null;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}

interface SessionRow {
  id_hash: string;
  account_id: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
}

interface OAuthTransactionRow {
  state_hash: string;
  provider: string;
  nonce: string;
  code_verifier: string | null;
  return_to: string;
  expires_at: number;
}

const account = (row: AccountRow): Account => ({
  id: row.id,
  email: row.email,
  createdAt: row.created_at,
  emailVerifiedAt: row.email_verified_at,
});

const identity = (row: IdentityRow): Identity => ({
  provider: oneOf(PROVIDERS, row.provider, 'identities.provider'),
  subject: row.subject,
  accountId: row.account_id,
  createdAt: row.created_at,
});

function purpose(row: MagicLinkRow): LinkPurpose {
  const kind = oneOf(PURPOSES, row.purpose, 'magic_links.purpose');
  if (kind === 'sign-in') return { kind };
  if (row.order_id === null) throw new RangeError('db: an order link without its order');
  return { kind, orderId: row.order_id };
}

const magicLink = (row: MagicLinkRow): MagicLink => ({
  tokenHash: row.token_hash,
  email: row.email,
  purpose: purpose(row),
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  usedAt: row.used_at,
});

const session = (row: SessionRow): Session => ({
  idHash: row.id_hash,
  accountId: row.account_id,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
  expiresAt: row.expires_at,
});

const oauthTransaction = (row: OAuthTransactionRow): OAuthTransaction => ({
  stateHash: row.state_hash,
  provider: oneOf(PROVIDERS, row.provider, 'oauth_transactions.provider'),
  nonce: row.nonce,
  codeVerifier: row.code_verifier,
  returnTo: row.return_to,
  expiresAt: row.expires_at,
});

/** What `purgeExpired` removed. */
export interface Purged {
  magicLinks: number;
  sessions: number;
  oauthTransactions: number;
}

export class D1AuthStore implements AuthStore {
  readonly #db: D1Like;

  constructor(db: D1Like) {
    this.#db = db;
  }

  async accountById(id: string): Promise<Account | undefined> {
    const row = await this.#db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<AccountRow>();
    return row ? account(row) : undefined;
  }

  async accountByEmail(email: string): Promise<Account | undefined> {
    const row = await this.#db.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first<AccountRow>();
    return row ? account(row) : undefined;
  }

  async insertAccount(a: Account): Promise<boolean> {
    const result = await this.#db
      .prepare('INSERT INTO accounts (id, email, created_at, email_verified_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
      .bind(a.id, a.email, a.createdAt, a.emailVerifiedAt)
      .run();
    return changesOf(result) === 1;
  }

  async markEmailVerified(accountId: string, at: number): Promise<void> {
    await this.#db.prepare('UPDATE accounts SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL').bind(at, accountId).run();
  }

  async deleteAccount(accountId: string): Promise<void> {
    await this.#db.prepare('DELETE FROM accounts WHERE id = ?').bind(accountId).run();
  }

  async identity(provider: ProviderId, subject: string): Promise<Identity | undefined> {
    const row = await this.#db.prepare('SELECT * FROM identities WHERE provider = ? AND subject = ?').bind(provider, subject).first<IdentityRow>();
    return row ? identity(row) : undefined;
  }

  async identitiesOf(accountId: string): Promise<Identity[]> {
    const result = await this.#db
      .prepare('SELECT * FROM identities WHERE account_id = ? ORDER BY created_at, provider, subject')
      .bind(accountId)
      .all<IdentityRow>();
    return rowsOf<IdentityRow>(result).map(identity);
  }

  async insertIdentity(i: Identity): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO identities (provider, subject, account_id, created_at)
         SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM accounts WHERE id = ?3)
         ON CONFLICT DO NOTHING`,
      )
      .bind(i.provider, i.subject, i.accountId, i.createdAt)
      .run();
  }

  async deleteIdentitiesOf(accountId: string): Promise<void> {
    await this.#db.prepare('DELETE FROM identities WHERE account_id = ?').bind(accountId).run();
  }

  async insertMagicLink(link: MagicLink): Promise<void> {
    await this.#db
      .prepare('INSERT INTO magic_links (token_hash, email, purpose, order_id, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(
        link.tokenHash,
        link.email,
        link.purpose.kind,
        link.purpose.kind === 'order' ? link.purpose.orderId : null,
        link.createdAt,
        link.expiresAt,
        link.usedAt,
      )
      .run();
  }

  async magicLinkByHash(tokenHash: string): Promise<MagicLink | undefined> {
    const row = await this.#db.prepare('SELECT * FROM magic_links WHERE token_hash = ?').bind(tokenHash).first<MagicLinkRow>();
    return row ? magicLink(row) : undefined;
  }

  async consumeMagicLink(tokenHash: string, at: number): Promise<boolean> {
    const result = await this.#db.prepare('UPDATE magic_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').bind(at, tokenHash).run();
    return changesOf(result) === 1;
  }

  async countMagicLinks(email: string, since: number): Promise<number> {
    const row = await this.#db
      .prepare('SELECT COUNT(*) AS n FROM magic_links WHERE email = ? AND created_at >= ?')
      .bind(email, since)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async deleteMagicLinksFor(email: string): Promise<void> {
    await this.#db.prepare('DELETE FROM magic_links WHERE email = ?').bind(email).run();
  }

  async insertSession(s: Session): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO sessions (id_hash, account_id, created_at, last_seen_at, expires_at)
         SELECT ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM accounts WHERE id = ?2)`,
      )
      .bind(s.idHash, s.accountId, s.createdAt, s.lastSeenAt, s.expiresAt)
      .run();
  }

  async sessionByHash(idHash: string): Promise<Session | undefined> {
    const row = await this.#db.prepare('SELECT * FROM sessions WHERE id_hash = ?').bind(idHash).first<SessionRow>();
    return row ? session(row) : undefined;
  }

  async touchSession(idHash: string, at: number): Promise<void> {
    await this.#db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?').bind(at, idHash).run();
  }

  async deleteSession(idHash: string): Promise<boolean> {
    const result = await this.#db.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(idHash).run();
    return changesOf(result) === 1;
  }

  async deleteSessionsOf(accountId: string): Promise<void> {
    await this.#db.prepare('DELETE FROM sessions WHERE account_id = ?').bind(accountId).run();
  }

  async insertOAuthTransaction(t: OAuthTransaction): Promise<void> {
    await this.#db
      .prepare('INSERT INTO oauth_transactions (state_hash, provider, nonce, code_verifier, return_to, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(t.stateHash, t.provider, t.nonce, t.codeVerifier, t.returnTo, t.expiresAt)
      .run();
  }

  async takeOAuthTransaction(stateHash: string): Promise<OAuthTransaction | undefined> {
    const [read, removed] = await this.#db.batch([
      this.#db.prepare('SELECT * FROM oauth_transactions WHERE state_hash = ?').bind(stateHash),
      this.#db.prepare('DELETE FROM oauth_transactions WHERE state_hash = ?').bind(stateHash),
    ]);
    const [row] = rowsOf<OAuthTransactionRow>(read);
    return row && changesOf(removed) === 1 ? oauthTransaction(row) : undefined;
  }

  /**
   * Housekeeping, beyond the contract: removes what can no longer be used. For a scheduled run; nothing depends
   * on it, since every read checks the times itself. An expired link is kept while it still counts towards the
   * address's rate limit (`countMagicLinks` over `linkCountWindow`).
   */
  async purgeExpired(now: number, settings: { linkCountWindow: number; sessionIdleTtl: number }): Promise<Purged> {
    const [links, sessions, transactions] = await this.#db.batch([
      this.#db.prepare('DELETE FROM magic_links WHERE expires_at <= ?1 AND created_at < ?2').bind(now, now - settings.linkCountWindow),
      this.#db.prepare('DELETE FROM sessions WHERE expires_at <= ?1 OR last_seen_at <= ?2').bind(now, now - settings.sessionIdleTtl),
      this.#db.prepare('DELETE FROM oauth_transactions WHERE expires_at <= ?').bind(now),
    ]);
    return { magicLinks: changesOf(links), sessions: changesOf(sessions), oauthTransactions: changesOf(transactions) };
  }
}
