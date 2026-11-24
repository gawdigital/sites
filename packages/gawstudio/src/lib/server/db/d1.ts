// The part of Cloudflare D1's Worker API this directory uses, as interfaces of our own: nothing here imports a
// package, the real `D1Database` binding satisfies `D1Like` as it is (`d1.test.ts` holds the compiler to that),
// and the tests put `bun:sqlite` behind the same shape (`testing.ts`).
//
// What the adapters rely on, checked against developers.cloudflare.com/d1 on 2026-11-24:
// - `batch()` is a transaction: the statements run in order, and when one fails the whole sequence is rolled
//   back (Worker API, D1Database, "batch()").
// - `meta.changes` of a write is the number of rows it changed (Worker API, "Return objects").
// - `first()` gives `null` when the query returns no row (Worker API, "Prepared statements").
// - Ordered (`?1`) and anonymous (`?`) parameters, at most 100 per statement; a statement of at most 100 kB; a
//   row of at most 2 MB; a `batch()` counts as one query of an invocation's 1,000 (50 on the free plan) and must
//   end within 30 seconds (Platform, "Limits").
// - Foreign keys are enforced in every query, as with `PRAGMA foreign_keys = on` (SQL API, "Foreign keys").
//
// UNVERIFIED: the documentation does not say which JavaScript values `bind()` takes. The adapters bind only
// strings, finite numbers and `null` (booleans as 0 and 1, never `undefined`), which is what `D1Value` allows.
// UNVERIFIED: `INSERT … ON CONFLICT DO NOTHING / DO UPDATE` and partial indexes are core SQLite (3.24 and 3.8)
// and D1 is SQLite, but the D1 pages name neither. `wrangler d1 migrations apply --local` settles it.

/** What the adapters bind. Integers stay exact up to 2^53: epoch milliseconds and minor units fit with room. */
export type D1Value = string | number | null;

export type D1Row = Record<string, unknown>;

export interface D1ResultLike<T = unknown> {
  /** The rows of a query; empty (or absent) for a write. */
  results?: T[] | null;
  meta: { changes: number };
}

export interface D1StatementLike {
  bind(...values: D1Value[]): D1StatementLike;
  first<T = D1Row>(): Promise<T | null>;
  all<T = D1Row>(): Promise<D1ResultLike<T>>;
  run(): Promise<D1ResultLike>;
}

export interface D1Like {
  prepare(sql: string): D1StatementLike;
  batch<T = unknown>(statements: D1StatementLike[]): Promise<D1ResultLike<T>[]>;
}

/** D1's limit of bound parameters per statement. */
export const MAX_BOUND_PARAMETERS = 100;

/** The rows of one result of a batch, typed by the caller who wrote the query. */
export function rowsOf<T>(result: D1ResultLike | undefined): T[] {
  return (result?.results ?? []) as T[];
}

/** How many rows a write changed. */
export function changesOf(result: D1ResultLike | undefined): number {
  return result?.meta.changes ?? 0;
}

/** A stored enumeration value, or an error: the schema has no CHECK on them, so a stray value stops here. */
export function oneOf<T extends string>(allowed: readonly T[], value: unknown, what: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw new RangeError(`db: ${what} holds ${JSON.stringify(value)}, which is none of ${allowed.join(', ')}`);
}

/** An ISO instant as epoch milliseconds. The modules that keep ISO strings write them with `toISOString()`. */
export function msOf(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new RangeError(`db: ${JSON.stringify(iso)} is not an instant`);
  return ms;
}

/** Epoch milliseconds as the ISO instant `toISOString()` writes, so a record comes back as it was saved. */
export function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}
