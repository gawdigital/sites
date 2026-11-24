// Money as every server module counts it: integer amounts in minor units (haléře, cents) with a currency code,
// and the one rounding rule. The quote (`orders`) and the invoice total (`invoicing`) are both computed with the
// functions below from the same quantities and unit prices, which is why they agree: by construction, not by
// comparing them afterwards.
//
// The rule: round to the minor unit, a half away from zero (0.5 → 1, −0.5 → −1). A line is its quantity times its
// unit price, rounded; VAT is computed once per rate on the sum of the lines, never per line.

export const CURRENCIES = ['CZK', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Rates are basis points, so they stay integers: 21 % is 2100, 5 % is 500. */
export const BASIS_POINTS = 10_000;

export const isCurrency = (s: unknown): s is Currency => typeof s === 'string' && (CURRENCIES as readonly string[]).includes(s);

/**
 * `n / d` rounded to the nearest integer, a half rounding away from zero. Exact for safe integers, since it never
 * leaves integer arithmetic.
 */
export function roundDiv(n: number, d: number): number {
  const a = Math.abs(n);
  const whole = Math.floor(a / d);
  const rounded = 2 * (a - whole * d) >= d ? whole + 1 : whole;
  return n < 0 ? -rounded : rounded;
}

/** A rate of an amount, rounded to the minor unit by `roundDiv`. */
export function percentOf(amount: number, rateBp: number): number {
  return roundDiv(amount * rateBp, BASIS_POINTS);
}

/** The net part of an amount that includes VAT, rounded to the minor unit; the VAT is the rest. */
export function netOfGross(gross: number, vatRateBp: number): number {
  return roundDiv(gross * BASIS_POINTS, BASIS_POINTS + vatRateBp);
}

/**
 * The amount of a line: its quantity times its unit price, rounded by the rule. A quantity may be a fraction
 * (an hour and a half of recording), so this one multiplication is done in floating point; the small tolerance
 * keeps a product that is exactly a half in true arithmetic from landing just under it as a float.
 */
export function lineAmount(quantity: number, unitPrice: number): number {
  const product = quantity * unitPrice;
  const rounded = Math.floor(Math.abs(product) + 0.5 + 1e-7);
  return product < 0 ? -rounded : rounded;
}

export interface Totals {
  /** Net of VAT. */
  subtotal: number;
  vat: number;
  /** What the customer pays. */
  total: number;
}

/**
 * Net, VAT and gross of a sum of lines at one VAT rate. Net prices: `vat = round(sum × rate)`, `total = sum +
 * vat`. Gross prices: `total` is the sum, `subtotal = round(total / (1 + rate))`, `vat = total − subtotal`.
 */
export function totals(sum: number, vatRateBp: number, pricesIncludeVat: boolean): Totals {
  if (pricesIncludeVat) {
    const subtotal = netOfGross(sum, vatRateBp);
    return { subtotal, vat: sum - subtotal, total: sum };
  }
  const vat = percentOf(sum, vatRateBp);
  return { subtotal: sum, vat, total: sum + vat };
}

/**
 * The totals of a document's lines: each line is `lineAmount`, and each VAT rate's sum is taxed on its own. With
 * one rate (every quote has one) this is `totals` of the sum of the lines.
 */
export function documentTotals(lines: readonly { quantity: number; unitPrice: number; vatRateBp: number }[], pricesIncludeVat: boolean): Totals {
  const sumByRate = new Map<number, number>();
  for (const line of lines) sumByRate.set(line.vatRateBp, (sumByRate.get(line.vatRateBp) ?? 0) + lineAmount(line.quantity, line.unitPrice));
  const sum: Totals = { subtotal: 0, vat: 0, total: 0 };
  for (const [rateBp, amount] of sumByRate) {
    const part = totals(amount, rateBp, pricesIncludeVat);
    sum.subtotal += part.subtotal;
    sum.vat += part.vat;
    sum.total += part.total;
  }
  return sum;
}
