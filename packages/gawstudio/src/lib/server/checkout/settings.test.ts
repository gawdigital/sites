import { describe, expect, test } from 'bun:test';

import { DEFAULT_SETTINGS } from '../booking/index.ts';
import type { BookingContext } from '../booking/index.ts';
import { EXAMPLE_CATALOGUE } from '../orders/index.ts';
import { COMGATE_MIN_EXPIRY, FakeProvider } from '../payments/index.ts';
import { startCheckout } from './start.ts';
import { checkoutReport } from './settings.ts';
import { recordingCart, studio } from './testing.ts';

const COMGATE_BOUNDS = { min: 30, max: 7 * 24 * 60 };

const context = (over: Partial<BookingContext['settings']> = {}, technicians = ['libor', 'nero']): Pick<BookingContext, 'settings' | 'technicians'> => ({
  settings: { ...DEFAULT_SETTINGS, ...over },
  technicians: technicians.map((id) => ({ id, busy: [] })),
});

describe('the report on the checkout’s settings', () => {
  test('finds nothing wrong with the defaults and the example catalogue', () => {
    const s = studio();
    const report = checkoutReport(s.deps, context());
    expect(report.problems).toEqual([]);
    expect(report.expiry).toEqual({ hold: 10, payment: undefined, bounds: undefined, exposed: undefined });
    expect(report.notices).toHaveLength(1);
    expect(report.notices[0]).toStartWith('No time to pay is set, so fake applies its own.');
  });

  test('says what a gateway with a 30-minute minimum means for a 10-minute hold, and changes neither', () => {
    expect(COMGATE_MIN_EXPIRY).toBe(30);
    const s = studio({ paymentExpiryMinutes: 30 }, 'memory', new FakeProvider({ expiryMinutes: COMGATE_BOUNDS }));
    const report = checkoutReport(s.deps, context());

    expect(report.problems).toEqual([]);
    expect(report.expiry).toEqual({ hold: 10, payment: 30, bounds: COMGATE_BOUNDS, exposed: 20 });
    expect(report.notices).toHaveLength(2);
    expect(report.notices[0]).toStartWith('A payment can be made for 30 minutes and a slot is held for 10: for up to 20 minutes');
    expect(report.notices[1]).toBe('fake cannot make a payment expire sooner than 30 minutes, and a slot is held for 10: to close the gap, hold for 30 minutes or more.');
    expect(DEFAULT_SETTINGS.holdMinutes).toBe(10);
  });

  test('a hold as long as the payment leaves no gap to report', () => {
    const s = studio({ paymentExpiryMinutes: 30 }, 'memory', new FakeProvider({ expiryMinutes: COMGATE_BOUNDS }));
    const report = checkoutReport(s.deps, context({ holdMinutes: 30 }));
    expect(report).toMatchObject({ problems: [], notices: [], expiry: { hold: 30, payment: 30, exposed: 0 } });
  });

  test('a time to pay the gateway refuses is a problem, and the gateway does refuse it', async () => {
    const s = studio({ paymentExpiryMinutes: 10 }, 'memory', new FakeProvider({ expiryMinutes: COMGATE_BOUNDS }));
    expect(checkoutReport(s.deps, context()).problems).toEqual(['The time to pay is 10 minutes; fake takes 30 to 10080 minutes, and refuses to open a payment otherwise.']);
    expect(await startCheckout(s.deps, recordingCart('order-rec-1'))).toEqual({ ok: false, error: 'payment-unavailable', retryable: false });

    expect(checkoutReport({ ...s.deps, settings: { ...s.deps.settings, paymentExpiryMinutes: 0.5 } }, context()).problems).toEqual(['The time to pay must be a whole number of minutes, at least 1.']);
  });

  test('gathers the booking’s own problems, the technicians’ and the hours’', () => {
    const s = studio();
    expect(checkoutReport(s.deps, context({ holdMinutes: 0 })).problems).toEqual(['The hold time must be a whole number, at least 1.']);
    expect(checkoutReport(s.deps, context({}, ['libor', 'guest'])).problems).toEqual(['Technician "guest" can be booked for a session and is not in the catalogue.']);

    const day = { ...EXAMPLE_CATALOGUE.recording!, day: { ...EXAMPLE_CATALOGUE.recording!.day, hours: 9 } };
    const hours = checkoutReport({ ...s.deps, catalogue: { ...EXAMPLE_CATALOGUE, recording: day } }, context()).problems;
    // One sentence for every day of the week the whole day can be booked on.
    expect(hours.length).toBeGreaterThan(0);
    expect(hours.every((problem) => problem.includes('9'))).toBe(true);

    const { recording: _, ...without } = EXAMPLE_CATALOGUE;
    expect(checkoutReport({ ...s.deps, catalogue: without }, context()).notices).toContain('The catalogue has no recording prices: a recording session cannot be ordered.');
  });
});
