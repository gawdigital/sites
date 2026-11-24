// The store in memory: what the tests run on, and a reference for the database one (the comments in `store.ts`
// say which operations must be atomic there).
import type { Account, AuthStore, Identity, MagicLink, OAuthTransaction, ProviderId, Session } from './store.ts';

const key = (provider: ProviderId, subject: string): string => `${provider}\n${subject}`;

export class MemoryAuthStore implements AuthStore {
  readonly accounts = new Map<string, Account>();
  readonly identities = new Map<string, Identity>();
  readonly links = new Map<string, MagicLink>();
  readonly sessions = new Map<string, Session>();
  readonly transactions = new Map<string, OAuthTransaction>();

  async accountById(id: string) {
    return copy(this.accounts.get(id));
  }

  async accountByEmail(email: string) {
    return copy([...this.accounts.values()].find((a) => a.email === email));
  }

  async insertAccount(account: Account) {
    // Checked and set without an `await` between: the unique index of a database, in one tick.
    if (this.accounts.has(account.id) || [...this.accounts.values()].some((a) => a.email === account.email)) return false;
    this.accounts.set(account.id, { ...account });
    return true;
  }

  async markEmailVerified(accountId: string, at: number) {
    const account = this.accounts.get(accountId);
    if (account && account.emailVerifiedAt === null) account.emailVerifiedAt = at;
  }

  async deleteAccount(accountId: string) {
    this.accounts.delete(accountId);
  }

  async identity(provider: ProviderId, subject: string) {
    return copy(this.identities.get(key(provider, subject)));
  }

  async identitiesOf(accountId: string) {
    return [...this.identities.values()].filter((i) => i.accountId === accountId).map((i) => ({ ...i }));
  }

  async insertIdentity(identity: Identity) {
    const k = key(identity.provider, identity.subject);
    if (!this.identities.has(k)) this.identities.set(k, { ...identity });
  }

  async deleteIdentitiesOf(accountId: string) {
    for (const [k, identity] of this.identities) if (identity.accountId === accountId) this.identities.delete(k);
  }

  async insertMagicLink(link: MagicLink) {
    this.links.set(link.tokenHash, { ...link });
  }

  async magicLinkByHash(tokenHash: string) {
    return copy(this.links.get(tokenHash));
  }

  async consumeMagicLink(tokenHash: string, at: number) {
    const link = this.links.get(tokenHash);
    if (!link || link.usedAt !== null) return false;
    link.usedAt = at;
    return true;
  }

  async countMagicLinks(email: string, since: number) {
    return [...this.links.values()].filter((l) => l.email === email && l.createdAt >= since).length;
  }

  async deleteMagicLinksFor(email: string) {
    for (const [k, link] of this.links) if (link.email === email) this.links.delete(k);
  }

  async insertSession(session: Session) {
    this.sessions.set(session.idHash, { ...session });
  }

  async sessionByHash(idHash: string) {
    return copy(this.sessions.get(idHash));
  }

  async touchSession(idHash: string, at: number) {
    const session = this.sessions.get(idHash);
    if (session) session.lastSeenAt = at;
  }

  async deleteSession(idHash: string) {
    return this.sessions.delete(idHash);
  }

  async deleteSessionsOf(accountId: string) {
    for (const [k, session] of this.sessions) if (session.accountId === accountId) this.sessions.delete(k);
  }

  async insertOAuthTransaction(transaction: OAuthTransaction) {
    this.transactions.set(transaction.stateHash, { ...transaction });
  }

  async takeOAuthTransaction(stateHash: string) {
    const transaction = this.transactions.get(stateHash);
    this.transactions.delete(stateHash);
    return transaction;
  }
}

/** Records leave the store as copies, as rows leave a database: changing one changes nothing stored. */
function copy<T extends object>(record: T | undefined): T | undefined {
  return record && { ...record };
}
