// The company's registered details, once for every site (they were in gawdigital.cz's translation files and page
// before). They are data, not copy: nothing here is translated. What a page says around them (the labels, the
// country's name, the register's sentence) is in the sites' translation files.

export const COMPANY = {
  name: 'G.A.W.Group, s.r.o.',
  /** The registered seat, a line each; the country follows in the page's language. */
  street: 'U smaltovny 1375/25',
  city: '170 00 Praha 7 – Holešovice',
  /** Company ID (IČO). */
  ico: '21697248',
  /** VAT ID (DIČ). */
  dic: 'CZ21697248',
  /** The file in section C of the Commercial Register kept by the Municipal Court in Prague. */
  registerFile: '405235',
  account: '342384729/0300',
  bank: 'ČSOB',
  iban: 'CZ6703000000000342384729',
  bic: 'CEKOCZPP',
} as const;

/** An IBAN as it is printed, in groups of four. */
export const ibanPrinted = (iban: string = COMPANY.iban): string => iban.replace(/(.{4})(?=.)/g, '$1 ');

/**
 * The seat as HTML, a line each, ending with the country in the page's language. Czech typography keeps a
 * one-letter preposition with the word after it, so a Czech page ties the street's with a no-break space.
 */
export const seatHtml = (country: string, locale = 'en'): string =>
  [locale === 'cs' ? COMPANY.street.replace(/^(\p{L}) /u, '$1\u00A0') : COMPANY.street, COMPANY.city, country].join('<br>');
