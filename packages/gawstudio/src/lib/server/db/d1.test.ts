import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { changesOf, isoOf, msOf, oneOf, rowsOf } from './d1.ts';
import type { D1Like } from './d1.ts';
import { memoryD1, migrationFiles } from './testing.ts';

// The compiler's check that the real binding fits: `D1Database` is the global type of `@cloudflare/workers-types`.
// (A type only: nothing is imported, and nothing runs.)
type Fits<Real extends D1Like> = Real;
export type RealBindingFits = Fits<D1Database>;

const TABLES = [
  'accounts',
  'booking_holds',
  'booking_orders',
  'booking_revision',
  'booking_sessions',
  'checkouts',
  'identities',
  'invoices',
  'magic_links',
  'oauth_transactions',
  'order_history',
  'order_lines',
  'order_work',
  'orders',
  'payments',
  'sessions',
  'uploads',
];

describe('the migrations', () => {
  test('apply to an empty database and make every table', () => {
    const db = memoryD1();
    const rows = db.sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
    expect(rows.map((row) => row.name)).toEqual(TABLES);
    expect(db.sqlite.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.sqlite.query('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
  });

  test('are numbered files of plain DDL: nothing D1 leaves undocumented, no address of ours', () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file).toMatch(/\/\d{4}_[a-z0-9_]+\.sql$/);
      const sql = readFileSync(file, 'utf8').replace(/--.*$/gm, '');
      expect(sql).not.toMatch(/\b(TRIGGER|RETURNING|STRICT|WITHOUT\s+ROWID|PRAGMA|BEGIN|COMMIT|AUTOINCREMENT)\b/i);
      expect(sql).not.toContain('@');
    }
  });

  test('every time is an INTEGER and every table of money has its currency', () => {
    const db = memoryD1();
    for (const table of TABLES) {
      const columns = db.sqlite.query(`PRAGMA table_info(${table})`).all() as { name: string; type: string }[];
      for (const column of columns) if (/(^|_)at$/.test(column.name)) expect(`${table}.${column.name} ${column.type}`).toBe(`${table}.${column.name} INTEGER`);
      const names = columns.map((column) => column.name);
      if (names.some((name) => ['amount', 'total'].includes(name)) && table !== 'order_lines') expect(names).toContain('currency');
    }
  });

  test('the booking revision starts at 0 and can have no second row', () => {
    const db = memoryD1();
    expect(db.sqlite.query('SELECT * FROM booking_revision').all()).toEqual([{ id: 1, revision: 0 }]);
    expect(() => db.sqlite.run('INSERT INTO booking_revision (id, revision) VALUES (2, 0)')).toThrow();
  });
});

describe('the shim keeps to what D1 documents', () => {
  test('a batch is one transaction: a failing statement undoes the ones before it', async () => {
    const db = memoryD1();
    const insert = (id: string, email: string) => db.prepare('INSERT INTO accounts (id, email, created_at) VALUES (?, ?, 1)').bind(id, email);
    await expect(db.batch([insert('a', 'a@example.com'), insert('b', 'a@example.com')])).rejects.toThrow(/UNIQUE/);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM accounts').first<{ n: number }>()).toEqual({ n: 0 });
  });

  test('changes are those of the statement itself; a read after a write reports none', async () => {
    const db = memoryD1();
    const [first, second, read] = await db.batch([
      db.prepare("INSERT INTO accounts (id, email, created_at) VALUES ('a', 'a@example.com', 1), ('b', 'b@example.com', 1)"),
      db.prepare("UPDATE accounts SET created_at = 2 WHERE id = 'nobody'"),
      db.prepare('SELECT id FROM accounts ORDER BY id'),
    ]);
    expect([changesOf(first), changesOf(second), changesOf(read)]).toEqual([2, 0, 0]);
    expect(rowsOf<{ id: string }>(read)).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  test('no row is null, foreign keys are enforced, and what D1 cannot bind is refused', async () => {
    const db = memoryD1();
    expect(await db.prepare('SELECT * FROM accounts WHERE id = ?').bind('nobody').first()).toBeNull();
    await expect(db.prepare("INSERT INTO sessions (id_hash, account_id, created_at, last_seen_at, expires_at) VALUES ('h', 'nobody', 1, 1, 2)").run()).rejects.toThrow(/FOREIGN KEY/);
    expect(() => db.prepare('SELECT ?').bind(undefined as unknown as null)).toThrow(TypeError);
    expect(() => db.prepare('SELECT 1').bind(...Array.from({ length: 101 }, () => 1))).toThrow(/100/);
  });
});

describe('the helpers', () => {
  test('an instant survives the trip to milliseconds and back', () => {
    const iso = new Date(1_800_000_000_123).toISOString();
    expect(msOf(iso)).toBe(1_800_000_000_123);
    expect(isoOf(msOf(iso))).toBe(iso);
    expect(() => msOf('yesterday')).toThrow(RangeError);
  });

  test('a stored value outside its enumeration is an error, not a record', () => {
    expect(oneOf(['a', 'b'] as const, 'b', 'x.y')).toBe('b');
    expect(() => oneOf(['a', 'b'] as const, 'c', 'x.y')).toThrow(/x\.y/);
    expect(() => oneOf(['a', 'b'] as const, null, 'x.y')).toThrow(RangeError);
  });
});
