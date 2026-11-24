// Money for the studio's orders. The amounts, the currencies and the one rounding rule every percentage (discount,
// VAT) and every line goes through are the server's shared ones (`../shared/money.ts`), which the invoicing uses
// too; this file passes them on and adds what only the orders need. No floats touch an amount.
import type { Currency } from '../shared/money.ts';

export { BASIS_POINTS, CURRENCIES, documentTotals, isCurrency, lineAmount, netOfGross, percentOf, roundDiv, totals } from '../shared/money.ts';
export type { Currency, Totals } from '../shared/money.ts';

/** A catalogue price: one integer amount in minor units per currency the item is sold in. */
export type Prices = Partial<Record<Currency, number>>;

/** A rate as invoice text: 2100 → `21 %`, 550 → `5.5 %`. */
export function formatRate(rateBp: number): string {
  return `${rateBp / 100} %`;
}
