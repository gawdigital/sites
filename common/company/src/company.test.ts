import { describe, expect, test } from 'bun:test';

import { BRANDS, GROUP } from './brands.ts';
import { COMPANY, ibanPrinted, seatHtml } from './company.ts';

describe('the company details', () => {
  test('the IBAN is printed in groups of four', () => {
    expect(ibanPrinted('XX00111122223333')).toBe('XX00 1111 2222 3333');
    expect(ibanPrinted('XX00')).toBe('XX00');
    expect(ibanPrinted().replaceAll(' ', '')).toBe(COMPANY.iban);
  });

  test('the IBAN holds the account and the bank code', () => {
    const [number, bank] = COMPANY.account.split('/');
    expect(COMPANY.iban.slice(4, 8)).toBe(bank);
    expect(COMPANY.iban.endsWith(number)).toBe(true);
  });

  test('the VAT ID is the company ID with the country', () => {
    expect(COMPANY.dic).toBe(`CZ${COMPANY.ico}`);
  });

  test('the seat ends with the country', () => {
    expect(seatHtml('Czech Republic')).toBe(`${COMPANY.street}<br>${COMPANY.city}<br>Czech Republic`);
  });

  test('a Czech page ties the one-letter preposition to the street', () => {
    expect(seatHtml('Česká republika', 'cs').startsWith('U\u00A0smaltovny')).toBe(true);
    expect(seatHtml('Tschechische Republik', 'de').startsWith('U smaltovny')).toBe(true);
  });
});

describe('the brands', () => {
  test('every brand has an https address on its domain', () => {
    for (const brand of [GROUP, ...BRANDS]) expect(brand.url).toBe(`https://${brand.domain}`);
  });
});
