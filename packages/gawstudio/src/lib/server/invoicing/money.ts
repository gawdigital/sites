// The one place where our integer minor units meet a provider's decimal strings. Done on digits, not with
// floating-point division, so 1 haléř never becomes 0.009999.
import { documentTotals } from '../shared/money.ts';
import type { Currency, DocumentDraft } from './types.ts';

/** Decimal places of each currency we sell in. */
const EXPONENT: Record<Currency, number> = { CZK: 2, EUR: 2 };

export function isCurrency(s: unknown): s is Currency {
  return typeof s === 'string' && Object.hasOwn(EXPONENT, s);
}

/** Minor units as a decimal string with every place written out: `121000` CZK is `"1210.00"`, `-50` is `"-0.50"`. */
export function toDecimal(minor: number, currency: Currency): string {
  if (!Number.isSafeInteger(minor)) throw new RangeError(`not an integer amount of minor units: ${minor}`);
  const places = EXPONENT[currency];
  const digits = String(Math.abs(minor)).padStart(places + 1, '0');
  const sign = minor < 0 ? '-' : '';
  return `${sign}${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

/**
 * A provider's decimal (`"1210.0"`, `"-0.5"`, `1210`) as minor units; `undefined` when it is not a plain decimal.
 * Places beyond the currency's own are rounded half away from zero.
 */
export function fromDecimal(decimal: string | number, currency: Currency): number | undefined {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(decimal).trim());
  if (!match) return undefined;
  const [, sign = '', whole = '0', fraction = ''] = match;
  const places = EXPONENT[currency];
  const kept = fraction.slice(0, places).padEnd(places, '0');
  const roundUp = (fraction[places] ?? '0') >= '5' ? 1 : 0;
  const minor = Number(whole + kept) + roundUp;
  if (!Number.isSafeInteger(minor)) return undefined;
  return sign && minor !== 0 ? -minor : minor;
}

/**
 * What a document made from a draft must total, with VAT, in minor units: `documentTotals` of `../shared/money.ts`,
 * the rule the orders' quote is priced by. A draft built from a quote's lines (same quantities, unit prices, rate
 * and price mode) therefore totals exactly what the quote did. A provider that computes its own total is held to
 * this figure by whoever issues the invoice.
 */
export function expectedTotal(draft: Pick<DocumentDraft, 'lines' | 'priceMode'>): number {
  const lines = draft.lines.map((line) => ({ quantity: line.quantity, unitPrice: line.unitPrice, vatRateBp: Math.round(line.vatRate * 100) }));
  return documentTotals(lines, draft.priceMode === 'gross').total;
}
