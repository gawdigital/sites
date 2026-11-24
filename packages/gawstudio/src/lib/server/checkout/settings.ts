// The one check of what the checkout is configured with, across the modules it puts together. Each module checks
// its own settings (`settingsProblems` of the booking); what no module can see alone is checked here:
//
// - the technicians the booking is given are the catalogue's (`technicianProblems`);
// - the hours the catalogue sells a block and a day for are the hours the booking's blocks last
//   (`recordingProblems`);
// - how long a payment can be made against how long its slot is held.
//
// The last one is a relationship, not a mistake. A slot is held for `holdMinutes` (10 by default); a provider's
// payment lives for `paymentExpiryMinutes`, or for the provider's own default, and a provider may refuse to make
// it shorter than a bound of its own (Comgate: 30 minutes). Whenever the payment outlives the hold there is a time
// in which the slot is on offer to others while the first customer can still pay. The checkout is built for it:
// the sweep cancels the payment at the provider once the hold has run out, and a payment that gets in first is
// accepted when the slot is still free (the booking's late acceptance) and refunded when it is not. The report
// says how long that time is, so that whoever sets the two values sees what they chose. Neither default is
// changed here.
import { recordingProblems, settingsProblems } from '../booking/index.ts';
import type { BookingContext } from '../booking/index.ts';
import { technicianProblems } from '../shared/technician.ts';
import type { CheckoutDeps } from './types.ts';

export interface CheckoutReport {
  /** What is wrong, in plain sentences for the admin: the checkout must not be opened while there is any. */
  problems: string[];
  /** What is as configured and has a consequence worth knowing. */
  notices: string[];
  /** The payment's time against the hold's, in minutes. */
  expiry: {
    hold: number;
    /** How long a payment can be made: the setting, or `undefined` for the provider's own default. */
    payment: number | undefined;
    /** The provider's bounds on the setting, where it has any. */
    bounds: { min: number; max: number } | undefined;
    /**
     * For how long a slot can be on offer again while its first payment can still be made: the payment's time
     * less the hold's, 0 when the hold lasts as long, `undefined` when the payment's time is the provider's secret.
     */
    exposed: number | undefined;
  };
}

/**
 * Checks the settings the checkout runs on: call it where the settings are saved (the admin) and before the first
 * checkout is started. `context` is what `deps.booking()` returns.
 */
export function checkoutReport(deps: Pick<CheckoutDeps, 'catalogue' | 'settings' | 'payments'>, context: Pick<BookingContext, 'settings' | 'technicians'>): CheckoutReport {
  const { catalogue, settings, payments } = deps;
  const own = settingsProblems(context.settings);
  const problems = [...own, ...technicianProblems(catalogue.technicians, context.technicians)];
  const notices: string[] = [];

  // The hours can only be compared once the booking's own settings make sense.
  if (catalogue.recording) problems.push(...(own.length === 0 ? recordingProblems(context.settings, catalogue.recording) : []));
  else notices.push('The catalogue has no recording prices: a recording session cannot be ordered.');

  const hold = context.settings.holdMinutes;
  const payment = settings.paymentExpiryMinutes;
  const bounds = payments.expiryMinutes;
  if (payment !== undefined && !(Number.isInteger(payment) && payment >= 1)) {
    problems.push('The time to pay must be a whole number of minutes, at least 1.');
  } else if (payment !== undefined && bounds && (payment < bounds.min || payment > bounds.max)) {
    problems.push(`The time to pay is ${payment} minutes; ${payments.name} takes ${bounds.min} to ${bounds.max} minutes, and refuses to open a payment otherwise.`);
  }

  let exposed: number | undefined;
  if (payment === undefined) {
    const least = bounds ? ` (at least ${bounds.min} minutes)` : '';
    notices.push(
      `No time to pay is set, so ${payments.name} applies its own${least}. A slot is held for ${hold} minutes: a payment made after that is accepted if the slot is still free and refunded if it is not.`,
    );
  } else {
    exposed = Math.max(0, payment - hold);
    if (exposed > 0) {
      notices.push(
        `A payment can be made for ${payment} minutes and a slot is held for ${hold}: for up to ${exposed} minutes the slot is on offer again while its first payment can still arrive. ` +
          `The sweep cancels such a payment${payments.cancel ? '' : ` (${payments.name} cannot cancel one, so it only learns its outcome)`}; one that arrives first is accepted if the slot is still free and refunded if it is not.`,
      );
    }
  }
  if (bounds && hold < bounds.min) {
    notices.push(`${payments.name} cannot make a payment expire sooner than ${bounds.min} minutes, and a slot is held for ${hold}: to close the gap, hold for ${bounds.min} minutes or more.`);
  }

  return { problems, notices, expiry: { hold, payment, bounds, exposed } };
}
