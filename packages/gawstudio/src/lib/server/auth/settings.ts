// Every duration the accounts use, in one object the caller passes in (from the site's settings): nothing here
// reads a clock or an environment.

/** Durations in milliseconds, like every `now` in this module (`Date.now()`). */
export interface AuthSettings {
  /** How long a sign-in link works: minutes. */
  signInLinkTtl: number;
  /** How long an order confirmation's link works: it sits in a mailbox, so longer than a sign-in link. */
  orderLinkTtl: number;
  /** The window over which issued links are counted per address, for the caller's rate limit. */
  linkCountWindow: number;
  /** A session unused for this long is over. */
  sessionIdleTtl: number;
  /** A session ends this long after sign-in, however busy. */
  sessionAbsoluteTtl: number;
  /** A session's last use is written at most this often, to spare a write per request. */
  sessionTouchInterval: number;
  /** How long a visitor has to come back from Google or Apple. */
  oauthTtl: number;
  /** Tolerated clock difference when reading an ID token's `exp`. */
  clockSkew: number;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Proposed values, the owner's to change; the order link's lifetime above all is a product decision. */
export const DEFAULT_AUTH_SETTINGS: AuthSettings = {
  signInLinkTtl: 15 * MINUTE,
  orderLinkTtl: DAY,
  linkCountWindow: 60 * MINUTE,
  sessionIdleTtl: 14 * DAY,
  sessionAbsoluteTtl: 90 * DAY,
  sessionTouchInterval: 5 * MINUTE,
  oauthTtl: 10 * MINUTE,
  clockSkew: MINUTE,
};
