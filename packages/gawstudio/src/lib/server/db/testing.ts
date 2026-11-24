// Test-only: an in-memory SQLite database (`bun:sqlite`) behind the D1 shape, with the real migration files
// applied. Never imported by the site: `bun:sqlite` does not exist on a Worker.
//
// It keeps to what D1 documents, so a test that passes here does not pass by an accident of the shim:
// foreign keys are enforced, a batch is one transaction that rolls back whole, `first()` gives `null` for no
// row, `meta.changes` counts the rows a write changed, more than 100 bound parameters are refused, and so is
// `undefined` as a parameter.
import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MAX_BOUND_PARAMETERS } from './d1.ts';
import type { D1Like, D1ResultLike, D1Row, D1StatementLike, D1Value } from './d1.ts';

export const MIGRATIONS_DIR = join(import.meta.dir, 'migrations');

/** The migration files, in the order wrangler applies them. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => join(MIGRATIONS_DIR, name));
}

class ShimStatement implements D1StatementLike {
  readonly #sqlite: Database;
  readonly #sql: string;
  readonly #params: D1Value[];

  constructor(sqlite: Database, sql: string, params: D1Value[] = []) {
    this.#sqlite = sqlite;
    this.#sql = sql;
    this.#params = params;
  }

  bind(...values: D1Value[]): D1StatementLike {
    if (values.length > MAX_BOUND_PARAMETERS) throw new Error(`shim: ${values.length} bound parameters; D1 allows ${MAX_BOUND_PARAMETERS}`);
    for (const value of values) {
      const ok = value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
      if (!ok) throw new TypeError(`shim: ${String(value)} cannot be bound`);
    }
    return new ShimStatement(this.#sqlite, this.#sql, values);
  }

  /** Runs the statement now, synchronously: what `batch` calls inside its transaction. */
  execute<T>(): D1ResultLike<T> {
    const total = (): number => (this.#sqlite.query('SELECT total_changes() AS n').get() as { n: number }).n;
    const before = total();
    const results = this.#sqlite.query(this.#sql).all(...this.#params) as T[];
    // `changes()` is only this statement's when the statement wrote; after a read it is still the last write's.
    const changes = total() === before ? 0 : (this.#sqlite.query('SELECT changes() AS n').get() as { n: number }).n;
    return { results, meta: { changes } };
  }

  async first<T = D1Row>(): Promise<T | null> {
    return this.execute<T>().results?.[0] ?? null;
  }

  async all<T = D1Row>(): Promise<D1ResultLike<T>> {
    return this.execute<T>();
  }

  async run(): Promise<D1ResultLike> {
    return this.execute();
  }
}

export interface MemoryD1 extends D1Like {
  /** The database underneath, for a test that wants to look at the rows themselves. */
  readonly sqlite: Database;
  /** How many `batch()` calls and single statements were sent: D1 counts each as one query of an invocation. */
  queries(): number;
}

/** A fresh database with every migration applied. */
export function memoryD1(): MemoryD1 {
  const sqlite = new Database(':memory:');
  sqlite.run('PRAGMA foreign_keys = ON');
  for (const file of migrationFiles()) sqlite.run(readFileSync(file, 'utf8'));
  let queries = 0;
  const inner = new WeakMap<D1StatementLike, ShimStatement>();
  const wrap = (statement: ShimStatement): D1StatementLike => {
    const outer: D1StatementLike = {
      bind: (...values) => wrap(statement.bind(...values) as ShimStatement),
      first: <T>() => (queries++, statement.first<T>()),
      all: <T>() => (queries++, statement.all<T>()),
      run: () => (queries++, statement.run()),
    };
    inner.set(outer, statement);
    return outer;
  };
  return {
    sqlite,
    queries: () => queries,
    prepare: (sql) => wrap(new ShimStatement(sqlite, sql)),
    async batch<T = unknown>(statements: D1StatementLike[]): Promise<D1ResultLike<T>[]> {
      queries++;
      const all = sqlite.transaction(() =>
        statements.map((statement) => {
          const shim = inner.get(statement);
          if (!shim) throw new TypeError('shim: a statement of another database');
          return shim.execute<T>();
        }),
      );
      return all();
    },
  };
}
