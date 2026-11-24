// Persistence for G.A.W.Studio on Cloudflare D1 (issue #29): the schema (`migrations/`), the accounts' store and
// the repositories that load and save the other modules' own records. Groundwork: no binding, no routes. Each
// class takes anything shaped like a D1 database (`D1Like`), which the `D1Database` binding is.
//
// For whoever wires it up: the migrations live beside this file, so the D1 binding in `wrangler.jsonc` needs
// `migrations_dir` pointing here (`src/lib/server/db/migrations`).
export { changesOf, isoOf, MAX_BOUND_PARAMETERS, msOf, rowsOf } from './d1.ts';
export type { D1Like, D1ResultLike, D1Row, D1StatementLike, D1Value } from './d1.ts';
export { D1AuthStore } from './auth-store.ts';
export type { Purged } from './auth-store.ts';
export { OrderRepository } from './orders.ts';
export type { StoredOrder } from './orders.ts';
export { PaymentRepository } from './payments.ts';
export type { OwedEffect } from './payments.ts';
export { InvoiceRepository } from './invoices.ts';
export { BookingRepository } from './booking.ts';
export type { LoadedBooking } from './booking.ts';
export { UploadRepository } from './uploads.ts';
export { D1CheckoutStore } from './checkout-store.ts';
