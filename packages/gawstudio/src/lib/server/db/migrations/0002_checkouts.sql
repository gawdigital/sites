-- G.A.W.Studio, second schema (issue #29): what the checkout keeps beside an order, and what a payment's record
-- has learnt to carry. Same conventions as 0001.

-- Payments -----------------------------------------------------------------------------------------------------------

-- `method` is how the customer paid, in the gateway's own code, once the gateway has said. `refunded` is how much
-- has been returned, in minor units: the gateway's figure where it reports one, the sum of our own successful
-- refunds where it does not (Comgate). NULL in either: not known.
ALTER TABLE payments ADD COLUMN method TEXT;
ALTER TABLE payments ADD COLUMN refunded INTEGER;

-- Checkouts ----------------------------------------------------------------------------------------------------------

-- One row beside every order that came through the checkout (`../../checkout`). The order itself, its lines and
-- its history are in the `orders` tables, and the order's `revision` is the checkout's version: a checkout is
-- saved in one batch with its order, and only while the order is at the revision the checkout was read with.
-- The customer's address is `orders.email`. `unfinished` is 1 while the sweep may still have something to do
-- (`isUnfinished`). `data` is JSON, written and read by the checkout's store only: the held slot, the session,
-- the payment's record, the payment page, the settlement, the refund and the alerts raised.
CREATE TABLE checkouts (
  order_id      TEXT    NOT NULL PRIMARY KEY REFERENCES orders (id) ON DELETE CASCADE,
  fingerprint   TEXT    NOT NULL,
  customer_name TEXT    NOT NULL,
  language      TEXT    NOT NULL,
  unfinished    INTEGER NOT NULL CHECK (unfinished IN (0, 1)),
  data          TEXT    NOT NULL
);
CREATE INDEX checkouts_unfinished ON checkouts (order_id) WHERE unfinished = 1;
