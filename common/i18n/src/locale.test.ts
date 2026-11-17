import { describe, expect, test } from 'bun:test';

import { alternates } from './alternates.ts';
import { isPrefixed, localeOf, pathOf, routeOf } from './locale.ts';

describe('locale routing', () => {
  test('English is unprefixed, the others are prefixed', () => {
    expect(pathOf('/', 'en')).toBe('/');
    expect(pathOf('/contact', 'en')).toBe('/contact');
    expect(pathOf('/', 'de')).toBe('/de');
    expect(pathOf('/apps/midi-control', 'cs')).toBe('/cs/apps/midi-control');
  });

  test('the locale and the route come off the path', () => {
    expect(localeOf('/')).toBe('en');
    expect(localeOf('/de')).toBe('de');
    expect(localeOf('/cs/privacy')).toBe('cs');
    expect(localeOf('/design')).toBe('en');
    expect(routeOf('/de')).toBe('/');
    expect(routeOf('/de/contact')).toBe('/contact');
    expect(routeOf('/contact')).toBe('/contact');
  });

  test('only the prefixed locales match the optional segment', () => {
    expect(isPrefixed('de')).toBe(true);
    expect(isPrefixed('cs')).toBe(true);
    expect(isPrefixed('en')).toBe(false);
    expect(isPrefixed('fr')).toBe(false);
  });

  test('alternates list every locale and x-default', () => {
    expect(alternates('https://example.com', '/privacy')).toEqual([
      { hreflang: 'en', href: 'https://example.com/privacy' },
      { hreflang: 'de', href: 'https://example.com/de/privacy' },
      { hreflang: 'cs', href: 'https://example.com/cs/privacy' },
      { hreflang: 'x-default', href: 'https://example.com/privacy' },
    ]);
  });
});
