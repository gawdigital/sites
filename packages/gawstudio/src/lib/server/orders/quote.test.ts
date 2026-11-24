import { describe, expect, test } from 'bun:test';

import { ANYONE, EXAMPLE_CATALOGUE, techniciansFor } from './catalogue.ts';
import type { Catalogue } from './catalogue.ts';
import { discountFor, quote, totals, trackPrice } from './quote.ts';
import type { Quote, QuoteRequest } from './quote.ts';

/** The example catalogue with add-ons and CZK prices for Libor's mix: prices made up for the tests. */
const CATALOGUE: Catalogue = {
  ...EXAMPLE_CATALOGUE,
  services: [
    { id: 'mix', name: 'Mix', kind: 'mix', load: 1000, prices: { libor: { EUR: 20_000, CZK: 500_000 }, nero: { EUR: 30_000 } } },
    ...EXAMPLE_CATALOGUE.services.slice(1),
    { id: 'ai-mix', name: 'AI mix', kind: 'ai-mix', load: 250, prices: { libor: { EUR: 5_000 } } },
  ],
  addOns: [
    { id: 'post', name: 'Post-production', kinds: ['mix'], prices: { EUR: 5_000, CZK: 125_000 }, load: 500 },
    { id: 'stems', name: 'Stems', kinds: ['mix', 'mastering'], prices: { EUR: 2_000 }, load: 0 },
  ],
};

function priced(catalogue: Catalogue, request: QuoteRequest): Quote {
  const result = quote(catalogue, request);
  if (!result.ok) throw new Error(`Not priced: ${JSON.stringify(result.errors)}`);
  return result.quote;
}

function errors(catalogue: Catalogue, request: QuoteRequest) {
  const result = quote(catalogue, request);
  return result.ok ? [] : result.errors;
}

describe('recording', () => {
  test('a 4 h block is 3,200 Kč, 3,872 Kč with VAT', () => {
    const q = priced(EXAMPLE_CATALOGUE, { currency: 'CZK', recording: [{ type: 'block' }] });
    expect(q).toMatchObject({ currency: 'CZK', pricesIncludeVat: false, subtotal: 320_000, vat: 67_200, total: 387_200 });
    expect(q.lines).toEqual([
      { type: 'recording', code: 'block', description: 'Recording, 4 h block', quantity: 1, unit: 'session', unitPrice: 320_000, amount: 320_000, vatRateBp: 2100 },
    ]);
    expect(q.work).toEqual([]);
  });

  test('a whole day is 6,400 Kč, 7,744 Kč with VAT', () => {
    const q = priced(EXAMPLE_CATALOGUE, { currency: 'CZK', recording: [{ type: 'day', date: '2026-12-01' }] });
    expect(q).toMatchObject({ subtotal: 640_000, vat: 134_400, total: 774_400 });
    expect(q.lines[0]!.description).toBe('Recording, whole day (8 h) (2026-12-01)');
  });

  test('a free window is paid by the hour', () => {
    const q = priced(EXAMPLE_CATALOGUE, { currency: 'CZK', recording: [{ type: 'window', minutes: 180 }] });
    expect(q.lines[0]).toMatchObject({ code: 'hour', quantity: 3, unit: 'hour', unitPrice: 80_000, amount: 240_000 });
    expect(q.total).toBe(290_400);
  });

  test('a window of part hours is rounded to the minor unit', () => {
    const catalogue: Catalogue = { ...EXAMPLE_CATALOGUE, recording: { ...EXAMPLE_CATALOGUE.recording!, hour: { CZK: 85 }, windowStepMinutes: 30 } };
    const q = priced(catalogue, { currency: 'CZK', recording: [{ type: 'window', minutes: 90 }] });
    expect(q.lines[0]).toMatchObject({ quantity: 1.5, amount: 128 }); // 127.5
  });

  test('a window must be a positive multiple of the step', () => {
    for (const minutes of [0, -60, 90, 60.5, Number.NaN]) {
      expect(errors(EXAMPLE_CATALOGUE, { currency: 'CZK', recording: [{ type: 'window', minutes }] })).toEqual([
        { code: 'invalid-session', path: 'recording[0]' },
      ]);
    }
  });

  test('several sessions add up', () => {
    const q = priced(EXAMPLE_CATALOGUE, { currency: 'CZK', recording: [{ type: 'block' }, { type: 'day' }] });
    expect(q.subtotal).toBe(960_000);
    expect(q.lines).toHaveLength(2);
  });

  test('recording has no EUR price in the example, and a catalogue may have no recording at all', () => {
    expect(errors(EXAMPLE_CATALOGUE, { currency: 'EUR', recording: [{ type: 'block' }] })).toEqual([{ code: 'no-price', path: 'recording[0]' }]);
    const { recording: _, ...without } = EXAMPLE_CATALOGUE;
    expect(errors(without, { currency: 'CZK', recording: [{ type: 'day' }] })).toEqual([{ code: 'no-recording', path: 'recording[0]' }]);
  });
});

describe('mix and mastering', () => {
  const cases: [service: string, technician: string, price: number][] = [
    ['mix', 'libor', 20_000],
    ['mix', 'nero', 30_000],
    ['mix-preprocess', 'libor', 40_000],
    ['mix-preprocess', 'nero', 50_000],
    ['mastering', 'libor', 10_000],
    ['mastering', 'risto', 18_000],
  ];

  test.each(cases)('one track of %s by %s', (service, technician, price) => {
    const q = priced(EXAMPLE_CATALOGUE, { currency: 'EUR', tracks: [{ service, technician, tracks: 1 }] });
    expect(q.lines).toHaveLength(1);
    expect(q.lines[0]).toMatchObject({ type: 'service', code: service, technician, quantity: 1, unit: 'track', unitPrice: price, amount: price });
    expect(q.subtotal).toBe(price);
    expect(q.vat).toBe(price * 0.21);
    expect(q.total).toBe(q.subtotal + q.vat);
  });

  test('the line names the service and the technician', () => {
    const q = priced(EXAMPLE_CATALOGUE, { currency: 'EUR', tracks: [{ service: 'mix', technician: 'nero', tracks: 2 }] });
    expect(q.lines[0]!.description).toBe('Mix — Nèro');
  });

  test('"anyone" pays the lowest technician price, or the catalogue\'s own price for it', () => {
    const q = priced(EXAMPLE_CATALOGUE, { currency: 'EUR', tracks: [{ service: 'mastering', technician: ANYONE, tracks: 2 }] });
    expect(q.lines[0]).toMatchObject({ description: 'Mastering', technician: ANYONE, unitPrice: 10_000, amount: 20_000 });

    const mix = { ...EXAMPLE_CATALOGUE.services[0]!, anyonePrices: { EUR: 25_000 } };
    expect(trackPrice(mix, ANYONE, 'EUR')).toBe(25_000);
    expect(trackPrice(mix, ANYONE, 'CZK')).toBeUndefined();
    expect(trackPrice(mix, 'nero', 'EUR')).toBe(30_000);
  });

  test('a technician is asked only for what they offer', () => {
    const request = (service: string, technician: string): QuoteRequest => ({ currency: 'EUR', tracks: [{ service, technician, tracks: 1 }] });
    expect(errors(EXAMPLE_CATALOGUE, request('mastering', 'nero'))).toEqual([{ code: 'not-offered', path: 'tracks[0]' }]);
    expect(errors(EXAMPLE_CATALOGUE, request('mix', 'nobody'))).toEqual([{ code: 'unknown-technician', path: 'tracks[0]' }]);
    expect(errors(EXAMPLE_CATALOGUE, request('remix', 'libor'))).toEqual([{ code: 'unknown-service', path: 'tracks[0]' }]);
    // A name every object has is not a technician.
    expect(errors(EXAMPLE_CATALOGUE, request('mix', 'constructor'))).toEqual([{ code: 'unknown-technician', path: 'tracks[0]' }]);
  });

  test('tracks are a positive whole number', () => {
    for (const tracks of [0, -1, 1.5, Number.NaN, Infinity]) {
      expect(errors(EXAMPLE_CATALOGUE, { currency: 'EUR', tracks: [{ service: 'mix', technician: 'libor', tracks }] })).toEqual([
        { code: 'invalid-tracks', path: 'tracks[0]' },
      ]);
    }
  });

  test('the candidates for "anyone" are those with a price in the currency', () => {
    expect(techniciansFor(EXAMPLE_CATALOGUE, 'mastering', 'EUR').map((t) => t.id)).toEqual(['libor', 'risto']);
    expect(techniciansFor(EXAMPLE_CATALOGUE, 'mastering', 'CZK')).toEqual([]);
    expect(techniciansFor(CATALOGUE, 'mix', 'CZK').map((t) => t.id)).toEqual(['libor']);
    expect(techniciansFor(EXAMPLE_CATALOGUE, 'remix', 'EUR')).toEqual([]);
  });
});

describe('the quantity discount', () => {
  const mix = (tracks: number): QuoteRequest => ({ currency: 'EUR', tracks: [{ service: 'mix', technician: 'libor', tracks }] });

  test('four tracks pay in full', () => {
    const q = priced(EXAMPLE_CATALOGUE, mix(4));
    expect(q.lines.map((l) => l.type)).toEqual(['service']);
    expect(q).toMatchObject({ subtotal: 80_000, vat: 16_800, total: 96_800 });
  });

  test('five tracks get 5 % off, as a line of its own', () => {
    const q = priced(EXAMPLE_CATALOGUE, mix(5));
    expect(q.lines[1]).toEqual({
      type: 'discount',
      code: 'quantity-5',
      description: 'Quantity discount −5 % (Mix, 5 tracks)',
      technician: 'libor',
      quantity: 1,
      unit: 'discount',
      unitPrice: -5_000,
      amount: -5_000,
      vatRateBp: 2100,
    });
    expect(q).toMatchObject({ subtotal: 95_000, vat: 19_950, total: 114_950 });
  });

  test('mastering gets it too, the AI kinds do not', () => {
    const master = priced(EXAMPLE_CATALOGUE, { currency: 'EUR', tracks: [{ service: 'mastering', technician: 'risto', tracks: 10 }] });
    expect(master.subtotal).toBe(171_000);
    const ai = priced(CATALOGUE, { currency: 'EUR', tracks: [{ service: 'ai-mix', technician: 'libor', tracks: 10 }] });
    expect(ai.lines.map((l) => l.type)).toEqual(['service']);
  });

  test('tracks are counted per line, not across the order', () => {
    const q = priced(EXAMPLE_CATALOGUE, {
      currency: 'EUR',
      tracks: [
        { service: 'mix', technician: 'libor', tracks: 3 },
        { service: 'mastering', technician: 'libor', tracks: 3 },
      ],
    });
    expect(q.lines.some((l) => l.type === 'discount')).toBe(false);
  });

  test('the discount is rounded half away from zero', () => {
    const at = (price: number): Catalogue => ({
      ...EXAMPLE_CATALOGUE,
      services: [{ id: 'mix', name: 'Mix', kind: 'mix', load: 1000, prices: { libor: { EUR: price } } }],
    });
    expect(priced(at(333), mix(5)).lines[1]!.amount).toBe(-83); // 83.25
    expect(priced(at(334), mix(5)).lines[1]!.amount).toBe(-84); // 83.5
  });

  test('add-ons are discounted only when the rule says so', () => {
    const request: QuoteRequest = { currency: 'EUR', tracks: [{ service: 'mix', technician: 'libor', tracks: 5, addOns: [{ id: 'post' }] }] };
    expect(priced(CATALOGUE, request).lines.map((l) => l.amount)).toEqual([100_000, 25_000, -5_000]);
    const all: Catalogue = { ...CATALOGUE, discounts: [{ ...CATALOGUE.discounts[0]!, includesAddOns: true }] };
    expect(priced(all, request).lines.map((l) => l.amount)).toEqual([100_000, 25_000, -6_250]);
  });

  test('of several rules the highest rate applies, alone', () => {
    const rules = [
      ...EXAMPLE_CATALOGUE.discounts,
      { id: 'quantity-10', name: 'Quantity discount', kinds: ['mix'] as const, minTracks: 10, rateBp: 1000, includesAddOns: false },
    ];
    expect(discountFor(rules, 'mix', 4)).toBeUndefined();
    expect(discountFor(rules, 'mix', 9)?.id).toBe('quantity-5');
    expect(discountFor(rules, 'mix', 10)?.id).toBe('quantity-10');
    expect(discountFor(rules, 'mastering', 10)?.id).toBe('quantity-5');
    const q = priced({ ...EXAMPLE_CATALOGUE, discounts: rules }, mix(10));
    expect(q.lines.map((l) => l.amount)).toEqual([200_000, -20_000]);
  });
});

describe('add-ons', () => {
  test('an add-on is priced per track, on all the tracks or on some', () => {
    const q = priced(CATALOGUE, {
      currency: 'EUR',
      tracks: [{ service: 'mix', technician: 'nero', tracks: 3, addOns: [{ id: 'post' }, { id: 'stems', tracks: 2 }] }],
    });
    expect(q.lines).toMatchObject([
      { type: 'service', amount: 90_000 },
      { type: 'addon', code: 'post', description: 'Post-production (Mix)', quantity: 3, unit: 'track', unitPrice: 5_000, amount: 15_000 },
      { type: 'addon', code: 'stems', quantity: 2, unitPrice: 2_000, amount: 4_000 },
    ]);
    expect(q).toMatchObject({ subtotal: 109_000, vat: 22_890, total: 131_890 });
  });

  test('an add-on adds its load to the work', () => {
    const q = priced(CATALOGUE, {
      currency: 'EUR',
      tracks: [
        { service: 'mix', technician: 'nero', tracks: 3, addOns: [{ id: 'post', tracks: 2 }, { id: 'stems' }] },
        { service: 'mastering', technician: ANYONE, tracks: 3 },
      ],
    });
    expect(q.work).toEqual([
      { service: 'mix', kind: 'mix', technician: 'nero', tracks: 3, load: 4000 },
      { service: 'mastering', kind: 'mastering', technician: ANYONE, tracks: 3, load: 1200 },
    ]);
  });

  test('an add-on must exist, fit the service, come once and cover no more tracks than the line', () => {
    const withAddOns = (addOns: { id: string; tracks?: number }[], service = 'mix', technician = 'libor'): QuoteRequest => ({
      currency: 'EUR',
      tracks: [{ service, technician, tracks: 2, addOns }],
    });
    expect(errors(CATALOGUE, withAddOns([{ id: 'vinyl' }]))).toEqual([{ code: 'unknown-addon', path: 'tracks[0].addOns[0]' }]);
    expect(errors(CATALOGUE, withAddOns([{ id: 'post' }], 'mastering'))).toEqual([{ code: 'addon-not-applicable', path: 'tracks[0].addOns[0]' }]);
    expect(errors(CATALOGUE, withAddOns([{ id: 'post' }, { id: 'post' }]))).toEqual([{ code: 'duplicate-addon', path: 'tracks[0].addOns[1]' }]);
    expect(errors(CATALOGUE, withAddOns([{ id: 'post', tracks: 3 }]))).toEqual([{ code: 'invalid-addon-tracks', path: 'tracks[0].addOns[0]' }]);
    expect(errors(CATALOGUE, withAddOns([{ id: 'post', tracks: 0 }]))).toEqual([{ code: 'invalid-addon-tracks', path: 'tracks[0].addOns[0]' }]);
  });
});

describe('currencies and VAT', () => {
  test('the same order is priced in either currency, never converted', () => {
    const request = (currency: 'CZK' | 'EUR'): QuoteRequest => ({
      currency,
      tracks: [{ service: 'mix', technician: 'libor', tracks: 1, addOns: [{ id: 'post' }] }],
    });
    expect(priced(CATALOGUE, request('EUR'))).toMatchObject({ currency: 'EUR', subtotal: 25_000, vat: 5_250, total: 30_250 });
    expect(priced(CATALOGUE, request('CZK'))).toMatchObject({ currency: 'CZK', subtotal: 625_000, vat: 131_250, total: 756_250 });
  });

  test('an item without a price in the currency stops the quote', () => {
    expect(errors(CATALOGUE, { currency: 'CZK', tracks: [{ service: 'mix', technician: 'nero', tracks: 1 }] })).toEqual([
      { code: 'no-price', path: 'tracks[0]' },
    ]);
    expect(errors(CATALOGUE, { currency: 'CZK', tracks: [{ service: 'mix', technician: 'libor', tracks: 1, addOns: [{ id: 'stems' }] }] })).toEqual([
      { code: 'no-price', path: 'tracks[0].addOns[0]' },
    ]);
  });

  test('recording and tracks share an order when both have a price', () => {
    const q = priced(CATALOGUE, { currency: 'CZK', recording: [{ type: 'block' }], tracks: [{ service: 'mix', technician: 'libor', tracks: 1 }] });
    expect(q.lines.map((l) => l.type)).toEqual(['recording', 'service']);
    expect(q).toMatchObject({ subtotal: 820_000, vat: 172_200, total: 992_200 });
  });

  test('prices that include VAT are the total, and the VAT is taken out of them', () => {
    const gross: Catalogue = { ...EXAMPLE_CATALOGUE, pricesIncludeVat: { CZK: false, EUR: true } };
    const q = priced(gross, { currency: 'EUR', tracks: [{ service: 'mix', technician: 'libor', tracks: 1 }] });
    expect(q).toMatchObject({ pricesIncludeVat: true, total: 20_000, subtotal: 16_529, vat: 3_471 });
    // The flag is per currency: CZK stays net.
    expect(priced(gross, { currency: 'CZK', recording: [{ type: 'block' }] }).total).toBe(387_200);
  });

  test('VAT is rounded once, on the sum', () => {
    expect(totals(95, 2100, false)).toEqual({ subtotal: 95, vat: 20, total: 115 });
    expect(totals(100, 2100, true)).toEqual({ subtotal: 83, vat: 17, total: 100 });
    expect(totals(387_200, 2100, true)).toEqual({ subtotal: 320_000, vat: 67_200, total: 387_200 });
    expect(totals(0, 2100, false)).toEqual({ subtotal: 0, vat: 0, total: 0 });
  });

  test('every amount of a quote is an integer and the lines add up to it', () => {
    const q = priced(CATALOGUE, {
      currency: 'EUR',
      tracks: [
        { service: 'mix-preprocess', technician: 'nero', tracks: 7, addOns: [{ id: 'post', tracks: 3 }, { id: 'stems' }] },
        { service: 'mastering', technician: 'risto', tracks: 7 },
      ],
    });
    for (const n of [q.subtotal, q.vat, q.total, ...q.lines.map((l) => l.amount)]) expect(Number.isSafeInteger(n)).toBe(true);
    expect(q.lines.reduce((sum, l) => sum + l.amount, 0)).toBe(q.subtotal);
    expect(q.subtotal + q.vat).toBe(q.total);
  });
});

describe('the request', () => {
  test('an empty order is not priced', () => {
    expect(errors(EXAMPLE_CATALOGUE, { currency: 'EUR' })).toEqual([{ code: 'empty', path: '' }]);
    expect(errors(EXAMPLE_CATALOGUE, { currency: 'EUR', recording: [], tracks: [] })).toEqual([{ code: 'empty', path: '' }]);
  });

  test('every problem is reported', () => {
    expect(
      errors(EXAMPLE_CATALOGUE, {
        currency: 'EUR',
        recording: [{ type: 'block' }],
        tracks: [
          { service: 'mix', technician: 'libor', tracks: 0 },
          { service: 'mix', technician: 'risto', tracks: 1 },
        ],
      }),
    ).toEqual([
      { code: 'no-price', path: 'recording[0]' },
      { code: 'invalid-tracks', path: 'tracks[0]' },
      { code: 'not-offered', path: 'tracks[1]' },
    ]);
  });

  test('company details travel with the quote, for the invoice', () => {
    const company = { name: 'Example s.r.o.', companyId: '00000000', vatId: 'CZ00000000' };
    expect(priced(EXAMPLE_CATALOGUE, { currency: 'CZK', recording: [{ type: 'block' }], company }).company).toEqual(company);
    expect('company' in priced(EXAMPLE_CATALOGUE, { currency: 'CZK', recording: [{ type: 'block' }] })).toBe(false);
  });
});
