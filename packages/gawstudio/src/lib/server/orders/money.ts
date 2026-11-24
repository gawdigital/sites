// Money for the studio's orders: integer amounts in minor units (haléře, cents) with a currency code, and the one
// rounding rule every percentage (discount, VAT) goes through. No floats touch an amount.

export const CURRENCIES = ['CZK', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** A catalogue price: one integer amount in minor units per currency the item is sold in. */
export type Prices = Partial<Record<Currency, number>>;

/** Rates are basis points, so they stay integers: 21 % is 2100, 5 % is 500. */
export const BASIS_POINTS = 10_000;

export const isCurrency = (s: string): s is Currency => (CURRENCIES as readonly string[]).includes(s);

/**
 * `n / d` rounded to the nearest integer, a half rounding away from zero (0.5 → 1, −0.5 → −1): the rounding rule
 * of this module. Exact for safe integers, since it never leaves integer arithmetic.
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

/** A rate as invoice text: 2100 → `21 %`, 550 → `5.5 %`. */
export function formatRate(rateBp: number): string {
  return `${rateBp / 100} %`;
}
