-- G.A.W.Studio, first schema (issue #29): accounts and sign-in, orders, payments, invoice references, bookings and
-- uploads. Plain SQLite DDL for Cloudflare D1.
--
-- Conventions:
-- - Times are epoch milliseconds in INTEGER columns named `*_at`. A calendar date (no time, no zone) is TEXT,
--   `YYYY-MM-DD`, and its column is not named `*_at`.
-- - Money is an INTEGER in minor units (haléře, cents) beside a `currency` column (ISO 4217).
-- - Secrets are never stored: `*_hash` columns hold the SHA-256 of a token, base64url.
-- - Enumerations (states, kinds, providers) are TEXT without a CHECK: the application's types are the list, and
--   adding a value must not need a table rebuild. The repositories refuse an unknown value when they read one.
-- - D1 enforces foreign keys in every query; this file creates parents before children and needs no deferral.
-- - No triggers, no STRICT, no WITHOUT ROWID, no RETURNING: nothing here depends on more than core SQLite.

-- Accounts -----------------------------------------------------------------------------------------------------------

-- One person, one address. The UNIQUE index on `email` is what makes "one account per address" hold when two
-- requests race to create it: the loser's insert does nothing and it reads the winner.
CREATE TABLE accounts (
  id                TEXT    NOT NULL PRIMARY KEY,
  email             TEXT    NOT NULL UNIQUE,
  created_at        INTEGER NOT NULL,
  email_verified_at INTEGER
);

-- A Google or Apple user attached to an account; the primary key keeps a provider user on one account only.
CREATE TABLE identities (
  provider   TEXT    NOT NULL,
  subject    TEXT    NOT NULL,
  account_id TEXT    NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_account ON identities (account_id);

-- Sign-in links. `used_at` goes from NULL to a time exactly once (`UPDATE … WHERE used_at IS NULL`). `order_id`
-- is not a foreign key: the accounts do not depend on the orders, and a link to a vanished order simply signs in.
CREATE TABLE magic_links (
  token_hash TEXT    NOT NULL PRIMARY KEY,
  email      TEXT    NOT NULL,
  purpose    TEXT    NOT NULL,
  order_id   TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  CHECK ((order_id IS NOT NULL) = (purpose = 'order'))
);
CREATE INDEX magic_links_email ON magic_links (email, created_at);
CREATE INDEX magic_links_expiry ON magic_links (expires_at);

CREATE TABLE sessions (
  id_hash      TEXT    NOT NULL PRIMARY KEY,
  account_id   TEXT    NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX sessions_account ON sessions (account_id);
CREATE INDEX sessions_expiry ON sessions (expires_at);

-- A sign-in under way at Google or Apple; the row is deleted by the callback that uses it.
CREATE TABLE oauth_transactions (
  state_hash    TEXT    NOT NULL PRIMARY KEY,
  provider      TEXT    NOT NULL,
  nonce         TEXT    NOT NULL,
  code_verifier TEXT,
  return_to     TEXT    NOT NULL,
  expires_at    INTEGER NOT NULL
);
CREATE INDEX oauth_transactions_expiry ON oauth_transactions (expires_at);

-- Orders -------------------------------------------------------------------------------------------------------------

-- An order: its lifecycle and the totals of the quote it was priced with. `revision` counts the writes: an update
-- names the revision it read and does nothing when another write came first. `account_id` and `email` are NULL
-- once the customer has been forgotten; the row itself is an accounting record and stays.
CREATE TABLE orders (
  id                 TEXT    NOT NULL PRIMARY KEY,
  revision           INTEGER NOT NULL DEFAULT 0,
  account_id         TEXT    REFERENCES accounts (id) ON DELETE SET NULL,
  email              TEXT,
  flow               TEXT    NOT NULL,
  state              TEXT    NOT NULL,
  state_since        INTEGER NOT NULL,
  delivered_at       INTEGER,
  expected_delivery  TEXT,
  currency           TEXT    NOT NULL,
  prices_include_vat INTEGER NOT NULL CHECK (prices_include_vat IN (0, 1)),
  vat_rate_bp        INTEGER NOT NULL,
  subtotal           INTEGER NOT NULL,
  vat                INTEGER NOT NULL,
  total              INTEGER NOT NULL,
  company_name       TEXT,
  company_id         TEXT,
  company_vat_id     TEXT,
  created_at         INTEGER NOT NULL
);
CREATE INDEX orders_account ON orders (account_id);
CREATE INDEX orders_email ON orders (email);
CREATE INDEX orders_state ON orders (state, state_since);

-- Every state an order has been in, oldest first. Append-only.
CREATE TABLE order_history (
  order_id TEXT    NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  seq      INTEGER NOT NULL,
  state    TEXT    NOT NULL,
  at       INTEGER NOT NULL,
  PRIMARY KEY (order_id, seq)
);

-- The priced lines. `quantity` is REAL: a recording window may be a fraction of an hour. Amounts are in the
-- order's currency and price basis; a discount line is negative.
CREATE TABLE order_lines (
  order_id    TEXT    NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  type        TEXT    NOT NULL,
  code        TEXT    NOT NULL,
  description TEXT    NOT NULL,
  technician  TEXT,
  quantity    REAL    NOT NULL,
  unit        TEXT    NOT NULL,
  unit_price  INTEGER NOT NULL,
  amount      INTEGER NOT NULL,
  vat_rate_bp INTEGER NOT NULL,
  PRIMARY KEY (order_id, position)
);

-- What the order puts into the technicians' queue.
CREATE TABLE order_work (
  order_id   TEXT    NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  service    TEXT    NOT NULL,
  kind       TEXT    NOT NULL,
  technician TEXT    NOT NULL,
  tracks     INTEGER NOT NULL,
  load       INTEGER NOT NULL,
  PRIMARY KEY (order_id, position)
);

-- Payments -----------------------------------------------------------------------------------------------------------

-- A payment at a gateway. `reference` is ours (the gateway echoes it); an order may have several attempts, so it
-- is not unique. `effect` is what the booking still owes this payment (`confirm`, `release`) and `effect_done_at`
-- when that was done: the status and the effect owed are written in one statement, so a Worker that dies between
-- the two leaves a row a later run can find and finish.
CREATE TABLE payments (
  provider       TEXT    NOT NULL,
  payment_id     TEXT    NOT NULL,
  reference      TEXT    NOT NULL,
  amount         INTEGER NOT NULL,
  currency       TEXT    NOT NULL,
  status         TEXT    NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  effect         TEXT    NOT NULL DEFAULT 'none',
  effect_done_at INTEGER,
  PRIMARY KEY (provider, payment_id)
);
CREATE INDEX payments_reference ON payments (reference);
CREATE INDEX payments_effect_owed ON payments (updated_at) WHERE effect <> 'none' AND effect_done_at IS NULL;

-- Invoices -----------------------------------------------------------------------------------------------------------

-- References to documents issued by the invoicing provider; the documents themselves live there. The UNIQUE
-- constraint is the rule "an order has one invoice, a refund one corrective document". No ON DELETE: an order
-- with an invoice cannot be deleted.
CREATE TABLE invoices (
  provider             TEXT    NOT NULL,
  document_id          TEXT    NOT NULL,
  order_id             TEXT    NOT NULL REFERENCES orders (id),
  kind                 TEXT    NOT NULL,
  number               TEXT    NOT NULL,
  reference            TEXT    NOT NULL,
  paid                 INTEGER NOT NULL CHECK (paid IN (0, 1)),
  total                INTEGER NOT NULL,
  currency             TEXT    NOT NULL,
  public_url           TEXT    NOT NULL,
  corrects_document_id TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  PRIMARY KEY (provider, document_id),
  UNIQUE (provider, kind, reference)
);
CREATE INDEX invoices_order ON invoices (order_id);

-- Bookings -----------------------------------------------------------------------------------------------------------

-- The booking state of the one studio: slots held while a customer pays, and confirmed sessions. A session keeps
-- the id of the hold it came from. Every change to these two tables goes through one batch that also moves
-- `booking_revision` on from the value it read, so two requests can never both take a slot.
CREATE TABLE booking_holds (
  id            TEXT    NOT NULL PRIMARY KEY,
  start_at      INTEGER NOT NULL,
  end_at        INTEGER NOT NULL,
  technician_id TEXT,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  CHECK (end_at > start_at)
);
CREATE INDEX booking_holds_expiry ON booking_holds (expires_at);

CREATE TABLE booking_sessions (
  id            TEXT    NOT NULL PRIMARY KEY,
  start_at      INTEGER NOT NULL,
  end_at        INTEGER NOT NULL,
  technician_id TEXT    NOT NULL,
  confirmed_at  INTEGER NOT NULL,
  CHECK (end_at > start_at)
);
CREATE INDEX booking_sessions_end ON booking_sessions (end_at);

CREATE TABLE booking_revision (
  id       INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL
);
INSERT INTO booking_revision (id, revision) VALUES (1, 0);

-- Which order a hold or session belongs to (an order may book several sessions). Keyed by the booking's id, which
-- a hold and its session share, so the link survives confirmation.
CREATE TABLE booking_orders (
  booking_id TEXT NOT NULL PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE
);
CREATE INDEX booking_orders_order ON booking_orders (order_id);

-- Uploads ------------------------------------------------------------------------------------------------------------

-- One multipart upload to R2. `object_key` is the object's key in the bucket.
CREATE TABLE uploads (
  object_key    TEXT    NOT NULL PRIMARY KEY,
  order_id      TEXT    NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  kind          TEXT    NOT NULL,
  track_id      TEXT    NOT NULL,
  file_id       TEXT    NOT NULL,
  size          INTEGER NOT NULL,
  part_size     INTEGER NOT NULL,
  part_count    INTEGER NOT NULL,
  upload_id     TEXT    NOT NULL,
  original_name TEXT    NOT NULL,
  content_type  TEXT    NOT NULL,
  state         TEXT    NOT NULL,
  etag          TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (order_id, kind, track_id, file_id)
);
CREATE INDEX uploads_state ON uploads (state, updated_at);
