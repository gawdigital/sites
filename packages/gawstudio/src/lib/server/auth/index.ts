// Accounts without passwords for G.A.W.Studio: sign-in by an e-mail link, with Google or with Apple; one account
// per verified address; the session in an HttpOnly cookie. Groundwork only: no routes, no database, no mail.
// Every `now` and every duration is in epoch milliseconds.
export { accountForOrder, deleteAccount, ensureAccount, signInWithProvider } from './accounts.ts';
export type { DeletionPlan, Ensured, ProviderUser } from './accounts.ts';
export {
  clearCookie,
  clearSessionCookie,
  localPath,
  OAUTH_COOKIE,
  readCookie,
  readSessionCookie,
  serializeCookie,
  SESSION_COOKIE,
  sessionCookie,
} from './cookie.ts';
export type { CookieOptions } from './cookie.ts';
export { isEmail, MAX_EMAIL, normaliseEmail } from './email.ts';
export { hashToken, randomToken, timingSafeEqual } from './encoding.ts';
export { decodeJwt, importEs256PrivateKey, signEs256, verifyRs256 } from './jwt.ts';
export type { DecodedJwt, Jwk, SignatureFailure } from './jwt.ts';
export { issueMagicLink, magicLinkUrl, recentLinkCount, redeem } from './magic-link.ts';
export type { IssuedLink, IssueRequest, Redeemed, RedeemFailure } from './magic-link.ts';
export { MemoryAuthStore } from './memory-store.ts';
export {
  APPLE,
  APPLE_SECRET_MAX_TTL,
  appleClient,
  appleClientSecret,
  beginSignIn,
  clearOAuthCookie,
  completeSignIn,
  exchangeCode,
  fetchJwks,
  GOOGLE,
  googleClient,
  verifyIdToken,
} from './oauth.ts';
export type {
  AppleKey,
  Callback,
  Fetch,
  IdClaims,
  IdTokenCheck,
  IdTokenFailure,
  OidcClient,
  OidcProvider,
  SignedIn,
  SignInFailure,
  SignInStart,
  VerifiedIdToken,
} from './oauth.ts';
export { createSession, revokeAllSessions, revokeSession, rotateSession, verifySession } from './session.ts';
export type { SessionFailure, StartedSession, VerifiedSession } from './session.ts';
export { DEFAULT_AUTH_SETTINGS } from './settings.ts';
export type { AuthSettings } from './settings.ts';
export type { Account, AuthStore, Identity, LinkPurpose, MagicLink, OAuthTransaction, ProviderId, Session } from './store.ts';
