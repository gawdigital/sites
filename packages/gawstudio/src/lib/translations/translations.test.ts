import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = import.meta.dir;
const read = async (path: string) => (await Bun.file(join(dir, path)).json()) as Record<string, unknown>;

/** Every key of a translation file, nested ones as `a.b`. */
const keys = (o: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'string' ? [prefix + k] : keys(v as Record<string, unknown>, `${prefix}${k}.`),
  );

/** The `{{placeholders}}` of every string, by key. */
const params = (o: Record<string, unknown>, prefix = ''): Record<string, string[]> =>
  Object.assign(
    {},
    ...Object.entries(o).map(([k, v]) =>
      typeof v === 'string'
        ? { [prefix + k]: [...v.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort() }
        : params(v as Record<string, unknown>, `${prefix}${k}.`),
    ),
  );

const namespaces = ['', ...readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)];

describe('the translation files', () => {
  for (const ns of namespaces) {
    test(`${ns || 'the base strings'}: German and Czech have English's keys and placeholders`, async () => {
      const en = await read(join(ns, 'en.json'));
      for (const locale of ['de', 'cs']) {
        const other = await read(join(ns, `${locale}.json`));
        expect(keys(other).sort()).toEqual(keys(en).sort());
        expect(params(other)).toEqual(params(en));
      }
    });
  }

  test('no page is left without a namespace', () => {
    expect(namespaces.sort()).toEqual(['', 'contact', 'home', 'mastering', 'mix', 'recording']);
  });
});
