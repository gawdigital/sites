import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { PREFIXED, pathOf, routeOf } from './locale.ts';

// The scripts are shipped verbatim (`?raw`), so the tests run their very source against stand-ins for the
// browser's globals.
const source = (name: string): string => readFileSync(new URL(`./scripts/${name}`, import.meta.url), 'utf8');

interface Visit {
  path?: string;
  search?: string;
  hash?: string;
  stored?: string | null;
  languages?: readonly string[];
  language?: string;
  /** localStorage throws, as with storage blocked. */
  blocked?: boolean;
}

/** Runs the head script on an unprefixed page; the address it replaces the page with, or `undefined`. */
function visit({ path = '/', search = '', hash = '', stored = null, languages, language, blocked }: Visit) {
  let target: string | undefined;
  const location = { pathname: path, search, hash, replace: (to: string) => (target = to) };
  const navigator = { languages, language };
  const localStorage = {
    getItem: (key: string) => {
      if (blocked) throw new Error('SecurityError');
      return key === 'lang' ? stored : null;
    },
  };
  new Function('location', 'navigator', 'localStorage', source('redirect.js'))(location, navigator, localStorage);
  return target;
}

describe('the redirect to the preferred language', () => {
  test('the script knows the site’s prefixed locales', () => {
    expect(source('redirect.js')).toContain(`var p=${JSON.stringify(PREFIXED).replaceAll('"', "'")}`);
  });

  test('the first of the browser’s languages the site has wins', () => {
    expect(visit({ languages: ['de-DE', 'en'] })).toBe('/de');
    expect(visit({ languages: ['cs'] })).toBe('/cs');
    expect(visit({ languages: ['fr-FR', 'sk', 'CS-cz', 'de'] })).toBe('/cs');
    expect(visit({ languages: ['en-US', 'de'] })).toBeUndefined();
    expect(visit({ languages: ['en-GB', 'cs'] })).toBeUndefined();
  });

  test('a browser with none of the site’s languages, or none at all, stays English', () => {
    expect(visit({ languages: ['fr', 'it'] })).toBeUndefined();
    expect(visit({ languages: [] })).toBeUndefined();
    expect(visit({})).toBeUndefined();
  });

  test('without navigator.languages, navigator.language decides', () => {
    expect(visit({ language: 'de-AT' })).toBe('/de');
    expect(visit({ languages: [], language: 'cs-CZ' })).toBe('/cs');
    expect(visit({ language: 'en-US' })).toBeUndefined();
  });

  test('a language chosen with the switch wins over the browser', () => {
    expect(visit({ stored: 'en', languages: ['de-DE'] })).toBeUndefined();
    expect(visit({ stored: 'cs', languages: ['de-DE'] })).toBe('/cs');
    expect(visit({ stored: 'de', languages: ['en-US'] })).toBe('/de');
  });

  test('a stored value that is no locale, or blocked storage, leaves it to the browser', () => {
    expect(visit({ stored: 'fr', languages: ['de'] })).toBe('/de');
    expect(visit({ stored: '', languages: ['en'] })).toBeUndefined();
    expect(visit({ blocked: true, languages: ['cs'] })).toBe('/cs');
    expect(visit({ blocked: true, languages: ['en'] })).toBeUndefined();
  });

  test('the target is the same page in that locale, query and hash kept', () => {
    for (const [path, search, hash] of [
      ['/', '', ''],
      ['/contact', '', ''],
      ['/apps/midi-control/support', '?x=1', '#faq'],
      ['/support', '?product=midi-control', '#contact'],
    ]) {
      for (const locale of PREFIXED) {
        const expected = pathOf(routeOf(path, 'en'), locale) + search + hash;
        expect(visit({ path, search, hash, languages: [locale] })).toBe(expected);
      }
    }
  });
});

describe('the language switch', () => {
  test('a click on a switch link stores its locale; the current one is no link', () => {
    const stored: Record<string, string> = {};
    const handlers: (() => void)[] = [];
    const link = (hreflang: string) => ({
      getAttribute: (name: string) => (name === 'hreflang' ? hreflang : null),
      addEventListener: (type: string, handler: () => void) => type === 'click' && handlers.push(handler),
    });
    let selector = '';
    const document = {
      querySelectorAll: (s: string) => {
        selector = s;
        return [link('cs'), link('de')];
      },
    };
    const localStorage = { setItem: (key: string, value: string) => (stored[key] = value) };
    new Function('document', 'localStorage', source('choice.js'))(document, localStorage);
    expect(selector).toBe('.lang a[hreflang]');
    handlers[1]();
    expect(stored).toEqual({ lang: 'de' });
    handlers[0]();
    expect(stored).toEqual({ lang: 'cs' });
  });

  test('blocked storage is no error', () => {
    const handlers: (() => void)[] = [];
    const document = {
      querySelectorAll: () => [
        { getAttribute: () => 'en', addEventListener: (_: string, h: () => void) => handlers.push(h) },
      ],
    };
    const localStorage = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    new Function('document', 'localStorage', source('choice.js'))(document, localStorage);
    expect(() => handlers[0]()).not.toThrow();
  });
});
