import { describe, expect, test } from 'bun:test';

import { type Content, faqFor, fetchContent, pick, productFor, queryUrl } from './cms.ts';
import { FAQ_KEYS } from './content.ts';

const t = (key: string) => (key === 'midisupport.trial_purchase' ? 'TRIAL &amp; PURCHASE' : `t:${key}`);

const content = (over: Partial<Content> = {}): Content => ({ products: [], faqs: [], ...over });

describe('pick', () => {
  test('takes the locale, English where it is empty', () => {
    expect(pick({ en: 'Hi', de: 'Hallo' }, 'de')).toBe('Hallo');
    expect(pick({ en: 'Hi', de: ' ' }, 'de')).toBe('Hi');
    expect(pick({ en: 'Hi' }, 'cs')).toBe('Hi');
    expect(pick(undefined, 'en')).toBe('');
  });
});

describe('faqFor', () => {
  test('falls back to the translation files, entities decoded, without a CMS', () => {
    const faq = faqFor(undefined, 'midi-control', 'en', t);
    expect(faq.map((g) => g.items.length)).toEqual(FAQ_KEYS['midi-control']!.map((g) => g.items.length));
    expect(faq[0]!.items[0]).toEqual({
      question: 't:midisupport.do_i_need_firewire_or',
      answer: 't:midisupport.no_the_app_talks_to',
    });
    expect(faq[2]!.title).toBe('TRIAL & PURCHASE');
  });

  test('falls back where the CMS holds no FAQ for the product, or only empty groups', () => {
    const empty = content({ faqs: [{ product: 'midi-control', groups: [{ title: { en: 'X' }, items: [] }] }] });
    expect(faqFor(empty, 'midi-control', 'en', t)).toEqual(faqFor(undefined, 'midi-control', 'en', t));
    expect(faqFor(content(), 'games', 'en', t)).toEqual([]);
  });

  test('uses the CMS FAQ in the locale, dropping incomplete items', () => {
    const cms = content({
      faqs: [
        { product: 'games', groups: [{ title: { en: 'Other' }, items: [{ question: { en: 'Q' }, answer: { en: 'A' } }] }] },
        {
          product: 'midi-control',
          groups: [
            {
              title: { en: 'Start', de: 'Start DE' },
              items: [
                { question: { en: 'Q1', de: 'F1' }, answer: { en: 'A1' } },
                { question: { en: 'Q2' } },
              ],
            },
          ],
        },
      ],
    });
    expect(faqFor(cms, 'midi-control', 'de', t)).toEqual([
      { title: 'Start DE', items: [{ question: 'F1', answer: 'A1' }] },
    ]);
  });
});

describe('productFor', () => {
  test('takes each field from the CMS where it is set there', () => {
    const cms = content({ products: [{ slug: 'games', name: { en: 'Games', cs: 'Hry' } }] });
    expect(productFor(cms, 'games', 'cs', t)).toEqual({ name: 'Hry', summary: 't:common.something_fun_is_in_the' });
    expect(productFor(undefined, 'midi-control', 'en', t)).toEqual({
      name: 't:common.midi_control_for_fireface',
      summary: 't:support.a_mac_control_surface_for',
    });
  });
});

describe('fetchContent', () => {
  test('queries the live API of the project and dataset', async () => {
    let url = '';
    const fetcher = (async (input: string) => {
      url = input;
      return Response.json({ result: { products: [{ slug: 'games' }] } });
    }) as unknown as typeof fetch;
    expect(await fetchContent('abc123', 'production', fetcher)).toEqual({ products: [{ slug: 'games' }], faqs: [] });
    expect(url).toBe(queryUrl('abc123', 'production'));
    expect(url.startsWith('https://abc123.api.sanity.io/v2025-02-19/data/query/production?perspective=published&query=')).toBe(true);
  });

  test('fails on an error answer rather than deploying the fallback', async () => {
    const fetcher = (async () => new Response('nope', { status: 500, statusText: 'Server Error' })) as unknown as typeof fetch;
    expect(fetchContent('abc123', 'production', fetcher)).rejects.toThrow('Sanity answered 500');
  });
});
