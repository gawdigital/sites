# G.A.W.Studio server groundwork

The server side of gawstudio.cz (issue #29), as modules of plain TypeScript with their tests beside them. Nothing
here is wired to the site yet: no routes, no bindings, no mail. Every module takes what it needs from outside
(`fetch`, the clock, a store) as an argument, so each runs under `bun test` as it is.

Conventions throughout: instants are epoch milliseconds (the orders keep ISO strings), money is a whole number of
minor units beside its currency, failures a caller is expected to handle are returned as values, and anything the
vendor documentation did not settle is marked `UNVERIFIED` where it matters.

## Modules

| Module      | What it does                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shared`    | What two modules must agree on: money arithmetic (`lineAmount`, `documentTotals`, rounding half away from zero) and the technician id (`TechnicianId`, `technicianProblems`).                                |
| `orders`    | The catalogue, the quote (`quote`), the order's lifecycle per flow (`transition`: classic, recording, AI) and the technicians' queue with delivery dates.                                                    |
| `booking`   | The studio's day: offered slots (`availability`), and the pure state machine of holds and sessions (`hold`, `confirm`, `confirmLate`, `expire`, `release`). `testing.ts` is its testing entry.               |
| `calendars` | The shared calendars behind one interface: iCloud over CalDAV, Google Calendar, an iCalendar reader, the conflict report, a fake.                                                                            |
| `payments`  | `PaymentProvider`, the Comgate adapter, `FakeProvider`, and `applyPaymentEvent`, which turns a provider's event into "confirm" or "release" at most once.                                                    |
| `invoicing` | `InvoicingProvider`, the Fakturoid adapter (invoice, payment, correction, e-mail), `FakeInvoicing`, and `expectedTotal`.                                                                                     |
| `auth`      | Accounts without passwords: magic links, Google and Apple sign-in, sessions in an HttpOnly cookie, behind `AuthStore`.                                                                                       |
| `files`     | Order files on R2: presigned multipart uploads and downloads, the upload plan, pasted links, retention and the deletion plan.                                                                                |
| `checkout`  | The use cases that put the above together: `startCheckout`, `handlePaymentNotification`, `sweep`, and `checkoutReport`. Side effects leave as data (`Effect`).                                               |
| `db`        | D1: the schema (`migrations/`), `D1AuthStore`, `D1CheckoutStore`, and repositories for orders, payments, invoices, bookings and uploads. `testing.ts` puts `bun:sqlite` with the real migrations behind D1's shape. |

### Where the modules meet

- **Money.** A quote's line amounts and totals and an invoice's expected total come from the same functions in
  `shared/money.ts` (VAT once per rate on the sum of the lines), so the amount charged and the amount invoiced
  agree by construction. The checkout's `invoice-total-mismatch` alert remains only as a guard on the invoicing
  provider's own arithmetic.
- **Technicians.** The catalogue's and the booking's technician records share `TechnicianRef`;
  `technicianProblems` reports ids that disagree.
- **Recording hours.** `recordingProblems` (booking) checks that the hours the catalogue sells a block and a day
  for are the hours the booking's blocks last.
- **Payment expiry and hold.** A slot is held for `holdMinutes` (10); Comgate cannot make a payment expire sooner
  than 30 minutes (`PaymentProvider.expiryMinutes`). Neither default is changed; `checkoutReport` states the gap.
- **One check.** `checkoutReport(deps, context)` gathers all of the above with the booking's own
  `settingsProblems` into `{ problems, notices, expiry }`. Run it where settings are saved and before going live.

## How a checkout runs

1. **Start** (`startCheckout`). The request is validated, a recording slot is looked up in what the booking offers
   at that instant and priced by its kind, tracks are priced from the catalogue. The slot is held under the
   order's id, the order is stored as `awaiting-payment` (before the payment exists, so no event can name an
   unknown order), the payment is created and the customer is sent to `redirectUrl`. The order id is the
   idempotency key: the same form sent again returns the same payment page.
2. **Notification** (`handlePaymentNotification`). The provider's POST is authenticated and, for Comgate,
   confirmed by asking for the status. `applyPaymentEvent` decides what the event means.
   - _paid_: the hold becomes a session (`confirmLate`), the order moves on (`paid`, or `awaiting-files` for
     classic), the account is ensured, the invoice is issued, marked paid and e-mailed, and the confirmation with
     the order's magic link is returned as an effect, with `order-paid` for the calendar or the AI draft.
   - _paid after the hold ran out_: late acceptance. `confirmLate` gives the slot if it is still free by the rules
     (lead time and horizon are not asked again). If it is not, no invoice is issued, the payment is refunded and
     the order goes from `awaiting-payment` straight to `refunded`; while the refund is pending or left to a
     person the order stays `awaiting-payment` and is not offered for payment again.
   - _cancelled_: the hold is released, the order cancelled, the customer told.
   Each step writes its marker in a versioned save, so a notification delivered again (or twice at once) repeats
   nothing and takes up whatever an earlier delivery could not finish.
3. **Sweep** (`sweep`, scheduled). Clears holds that ran out, cancels their payments at the provider (or learns
   they were paid after all), retries invoices and refunds, and reports refunds left to a person and overdue
   orders.

The caller sends the effects (e-mails as template and data; the studio's address is the caller's `MAIL_TO`), and
should queue them before answering the provider.

`CheckoutStore` has two implementations, and the checkout's behaviour tests run on both: `MemoryCheckoutStore`
and `D1CheckoutStore`. On D1 the order and quote live in the `orders` tables, the checkout's version is the
order's `revision`, the booking state goes through `BookingRepository`, and the rest is one row in `checkouts`.

## Not wired yet

- No route calls any of this: `/api/contact` is still the site's only server route, and pages are prerendered.
- No D1, R2 or cron binding in `wrangler.jsonc`; no secrets set; no mail sender for the effects; no translations
  for the e-mail templates.
- `deps.booking()` (settings, calendar busy time, technicians) has no implementation: nothing reads the
  calendars into a `BookingContext` yet, and `order-paid` does not write the session to a calendar.
- Catalogue, booking, order and checkout settings are constants; there is no admin and no table for them.
- The `payments` and `invoices` tables and their repositories are not used by `D1CheckoutStore`, which keeps the
  payment's record and the invoice's id inside the checkout row. Mirror them if they are wanted as rows.
- Account deletion: `deleteAccount` returns a plan; nothing carries it out (`OrderRepository.anonymise` and
  `D1CheckoutStore.anonymise` exist for it).
- File retention: `deletionPlan` exists; no job runs it. Uploads are not tied to the order's lifecycle yet.
- Refunds happen only for a lost slot. A refund asked for by the customer or the studio, and the corrective
  document for an invoiced order (`issueCorrection`), have no use case.
- `exchangeRate` for invoices in EUR has no source.

## Owner decisions

- **Prices.** `EXAMPLE_CATALOGUE` is a starting point: recording 800 Kč an hour net, the old store's EUR prices
  taken as net, no add-on prices. The two AI services (`ai-mix`, `ai-mastering`) are placeholders: prices, queue
  weights and who curates them.
- **Booking.** Lead time (24 h), horizon, opening hours and "every day of the week" are placeholders.
- **Hold against payment expiry.** Keep the 10-minute hold and accept that a Comgate payment can outlive it by
  20 minutes or more (late acceptance, or a refund), or hold for 30 minutes. Also whether to set
  `paymentExpiryMinutes` at all.
- **Late acceptance** ignores the lead time and the horizon, and refuses a slot that has begun. Confirm.
- **A paid order that lost its slot** is never `paid`: it stays `awaiting-payment` until refunded and then is
  `refunded`. It shows as overdue in the sweep's report while a refund waits for a person.
- **Order deadlines** per state (`EXAMPLE_SETTINGS`) are placeholders; file retention is the specification's 30
  days.
- **Auth.** Lifetimes of links and sessions, above all the order link's (`auth/settings.ts`).
- **Checkout.** The payment label, the invoice tag and note, the invoice's payment method, and whether Fakturoid
  e-mails the invoice itself (`DEFAULT_CHECKOUT_SETTINGS`).
- **Anonymisation.** Which fields of an order and an invoice may be removed when an account is deleted is the
  owner's and the accountant's call; the code removes everything that names the customer.
- **Apple sign-in** needs the developer membership; leave it off the page until there is a key.

## UNVERIFIED

Each is marked in the code where it matters, with what the code does instead.

- **Comgate** (`payments/comgate.ts`): the body of a non-2xx answer; the body expected in the notification's
  answer; whether several partial refunds may follow each other; whether notifications can arrive out of order;
  whether a Worker's outgoing addresses can go on the allowed-IP list; whether `method` in a status answer
  becomes the method the payer chose (the sample shows `ALL`, which is not reported); the default expiry when
  none is sent. Documented, not unverified: Comgate reports no refund state at all, so a refund is recorded only
  when our own refund call succeeds (`noteRefund`).
- **Fakturoid** (`invoicing/fakturoid.ts`, `token.ts`): the sign of a correction's lines; whether
  `exchange_rate` is defaulted; whether `custom_id` is unique and matched exactly; whether a negative
  `unit_price` is accepted; the status for wrong client credentials; and that its rounding matches ours (the
  mismatch alert watches this).
- **R2** (`files/r2.ts`, `retention.ts`): `response-content-disposition` on GetObject; custom metadata on
  multipart uploads; path-style addressing in production; `?uploads=`; that CORS must expose `ETag`; whether a
  multipart object's age counts from completion.
- **D1** (`db/d1.ts`): the values `bind()` takes; `ON CONFLICT` and partial indexes (core SQLite, not named in
  D1's pages). `wrangler d1 migrations apply --local` settles the second.
- **iCloud CalDAV** (`calendars/caldav.ts`): how the partition host is reached; whether `<C:expand>` is honoured;
  an ETag on PUT; request limits.
- **Google Calendar** (`calendars/google.ts`): 409 on inserting an existing or deleted id; 410 or 404 on delete;
  the format of `X-Goog-Channel-Expiration`; the longest channel lifetime and free/busy window.

## Wiring it up

Changes to `wrangler.jsonc` and the dashboard, in the order they unblock things. Account ids, bucket names and
credentials never go into the repository.

1. **D1.** Create the database and add its binding to `packages/gawstudio/wrangler.jsonc` with
   `migrations_dir` set to `src/lib/server/db/migrations`. Apply with
   `bunx --bun wrangler d1 migrations apply <database> --local`, then `--remote`. Migrations are append-only:
   add `0003_….sql`, never edit an applied file.
2. **R2.** Create the bucket (in the `eu` jurisdiction if wanted; it cannot be changed later) and an R2 API token
   for it. Set CORS on the bucket: the site's origin, methods `PUT` and `GET`, and `ETag` among the exposed
   headers (the browser needs each part's ETag). Add the two lifecycle rules described in
   `files/retention.ts` as a backstop.
3. **Secrets**, with `wrangler secret put` on the gawstudio Worker (`.dev.vars` locally, never committed). The
   contact form's are `TURNSTILE_SECRET_KEY`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_TO`. This
   groundwork needs, under names still to be chosen: the Comgate merchant id and secret; the Fakturoid client
   id, client secret, account slug and User-Agent contact; the R2 account id, access key id and secret access
   key; the Google OAuth client id and secret; the Apple team id, key id, Services ID and private key; the
   calendar credentials (an iCloud app-specific password, Google access).
4. **Comgate portal.** Set the result URL to the notification route, enable the card method (Apple Pay and
   Google Pay follow), and settle the allowed-IP question above before relying on API calls from a Worker.
5. **Routes.** A checkout endpoint (`startCheckout`), the provider's notification endpoint
   (`handlePaymentNotification`; answer with `acknowledge`, or with `status` when `ok` is false), sign-in
   callbacks, and upload endpoints. Build `CheckoutDeps` once per request from the bindings, with
   `new D1CheckoutStore(env.DB)` and `new D1AuthStore(env.DB)`.
6. **Scheduled sweep.** Add a cron trigger (every few minutes) whose handler calls `sweep`, sends its effects,
   purges expired auth rows and, later, runs the files' deletion plan. Check how the installed SvelteKit
   Cloudflare adapter exposes a `scheduled` handler (UNVERIFIED here); failing that, a small wrapper around the
   generated Worker or a second Worker bound to the same database does it.
7. **Before opening.** Run `checkoutReport` against the live settings and resolve every problem; read its
   notices. Keep `acceptTestPayments` off outside Comgate's test mode.
