import { describe, expect, test } from 'bun:test';

import { expectedTotal } from '../invoicing/index.ts';
import type { InvoiceLine } from '../invoicing/index.ts';
import { EXAMPLE_CATALOGUE, quote } from '../orders/index.ts';
import type { Catalogue, Quote, QuoteRequest } from '../orders/index.ts';
import { documentTotals, lineAmount, totals } from './money.ts';
import { technicianProblems } from './technician.ts';

describe('the one rounding rule', () => {
  test('a line is its quantity times its unit price, a half rounding away from zero', () => {
    expect(lineAmount(2, 20_000)).toBe(40_000);
    expect(lineAmount(1.5, 80_000)).toBe(120_000);
    expect(lineAmount(0.5, 5)).toBe(3);
    expect(lineAmount(0.5, -5)).toBe(-3);
    expect(lineAmount(1, -2_500)).toBe(-2_500);
    // A third of an hour: 0.3333… × 90 is 29.999… as a float, and 30 in fact.
    expect(lineAmount(20 / 60, 90)).toBe(30);
    expect(lineAmount(10 / 60, 3)).toBe(1);
  });

  test('a document of one rate totals as the sum of its lines does', () => {
    const lines = [
      { quantity: 5, unitPrice: 10_000, vatRateBp: 2100 },
      { quantity: 1, unitPrice: -2_500, vatRateBp: 2100 },
    ];
    expect(documentTotals(lines, false)).toEqual(totals(47_500, 2100, false));
    expect(documentTotals(lines, true)).toEqual(totals(47_500, 2100, true));
    expect(documentTotals([], false)).toEqual({ subtotal: 0, vat: 0, total: 0 });
  });
});

describe('a quote and the invoice made from its lines', () => {
  // The lines as the checkout hands them to the invoicing: quantity, unit price, the rate in percent.
  const invoiceLines = (priced: Quote): InvoiceLine[] =>
    priced.lines.map((line) => ({ name: line.description, quantity: line.quantity, unitPrice: line.unitPrice, vatRate: line.vatRateBp / 100 }));

  const AWKWARD: Catalogue = {
    ...EXAMPLE_CATALOGUE,
    vatRateBp: 2100,
    recording: { block: { hours: 4, prices: { CZK: 333_333 } }, day: { hours: 8, prices: { CZK: 640_001 } }, hour: { CZK: 79_999 }, windowStepMinutes: 10 },
    services: [{ id: 'mix', name: 'Mix', kind: 'mix', load: 1000, prices: { libor: { CZK: 33_333, EUR: 1_999 } } }],
    addOns: [{ id: 'tuning', name: 'Tuning', kinds: ['mix'], prices: { CZK: 1_111, EUR: 333 }, load: 0 }],
    discounts: [{ id: 'q', name: 'Quantity', kinds: ['mix'], minTracks: 3, rateBp: 750, includesAddOns: true }],
  };

  const carts: QuoteRequest[] = [
    { currency: 'CZK', recording: [{ type: 'block' }, { type: 'day' }, { type: 'window', minutes: 90 }] },
    ...[10, 20, 50, 70, 250, 290].map((minutes): QuoteRequest => ({ currency: 'CZK', recording: [{ type: 'window', minutes }] })),
    ...[1, 3, 7, 13].flatMap((tracks): QuoteRequest[] => [
      { currency: 'CZK', tracks: [{ service: 'mix', technician: 'libor', tracks, addOns: [{ id: 'tuning' }] }] },
      { currency: 'EUR', tracks: [{ service: 'mix', technician: 'libor', tracks, addOns: [{ id: 'tuning', tracks: 1 }] }] },
    ]),
  ];

  for (const pricesIncludeVat of [false, true]) {
    test(`have the same total by construction, with ${pricesIncludeVat ? 'gross' : 'net'} prices`, () => {
      const catalogue: Catalogue = { ...AWKWARD, pricesIncludeVat: { CZK: pricesIncludeVat, EUR: pricesIncludeVat } };
      for (const cart of carts) {
        const priced = quote(catalogue, cart);
        if (!priced.ok) throw new Error(`no quote: ${JSON.stringify(priced.errors)}`);
        const lines = invoiceLines(priced.quote);
        expect(lines.map((line) => lineAmount(line.quantity, line.unitPrice))).toEqual(priced.quote.lines.map((line) => line.amount));
        expect(expectedTotal({ lines, priceMode: pricesIncludeVat ? 'gross' : 'net' })).toBe(priced.quote.total);
      }
    });
  }
});

describe('the technicians of the catalogue and of the booking', () => {
  const catalogue = EXAMPLE_CATALOGUE.technicians;

  test('agree when everyone bookable is in the catalogue', () => {
    expect(technicianProblems(catalogue, [{ id: 'libor' }, { id: 'nero' }])).toEqual([]);
    expect(technicianProblems(catalogue, [])).toEqual([]);
  });

  test('an unknown or repeated id is reported', () => {
    expect(technicianProblems([...catalogue, { id: 'libor' }], [{ id: 'anna' }, { id: 'nero' }, { id: 'nero' }])).toEqual([
      'Technician "libor" is listed twice in the catalogue.',
      'Technician "nero" is listed twice for booking.',
      'Technician "anna" can be booked for a session and is not in the catalogue.',
    ]);
  });
});
