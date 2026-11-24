// What the checkout's tests share: a studio in memory, with the fake providers, a clock a test can move, and
// the customer's side of a payment played in one line.
import { DEFAULT_AUTH_SETTINGS, MemoryAuthStore } from '../auth/index.ts';
import { DEFAULT_SETTINGS, instantOf, minutesOf } from '../booking/index.ts';
import type { BookingContext, Busy } from '../booking/index.ts';
import { FakeInvoicing } from '../invoicing/index.ts';
import { EXAMPLE_CATALOGUE, EXAMPLE_SETTINGS } from '../orders/index.ts';
import type { Catalogue } from '../orders/index.ts';
import { FakeProvider } from '../payments/index.ts';
import type { PaymentStatus } from '../payments/index.ts';
import { handlePaymentNotification } from './notify.ts';
import { MemoryCheckoutStore } from './store.ts';
import { DEFAULT_CHECKOUT_SETTINGS } from './types.ts';
import type { CheckoutDeps, CheckoutRequest, CheckoutSettings, Effect, NotificationResult, SlotChoice } from './types.ts';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const NOW = Date.parse('2026-05-20T08:00:00Z');
export const DAY = '2026-06-01';

/** A slot of the studio's day, by its wall-clock times in Prague. */
export const slot = (start: string, end: string, technicianId: string | null = null, date = DAY): SlotChoice => ({
  start: instantOf(date, minutesOf(start), DEFAULT_SETTINGS.timeZone),
  end: instantOf(date, minutesOf(end), DEFAULT_SETTINGS.timeZone),
  technicianId,
});

export const MORNING = slot('09:00', '13:00');

/** The example catalogue with one AI-assisted service, which the example does not price yet. */
export const CATALOGUE: Catalogue = {
  ...EXAMPLE_CATALOGUE,
  services: [...EXAMPLE_CATALOGUE.services, { id: 'ai-mix', name: 'AI Mix', kind: 'ai-mix', load: 300, prices: { libor: { EUR: 5_000 } } }],
};

export const CUSTOMER = { email: 'name@example.com', name: 'Jane Doe', language: 'en' } as const;

export const recordingCart = (orderId: string, recording: SlotChoice = MORNING): CheckoutRequest => ({ orderId, customer: CUSTOMER, currency: 'CZK', recording });

export const tracksCart = (orderId: string, service = 'mix', tracks = 2): CheckoutRequest => ({
  orderId,
  customer: CUSTOMER,
  currency: 'EUR',
  tracks: [{ service, technician: 'libor', tracks }],
});

export interface Studio {
  deps: CheckoutDeps;
  store: MemoryCheckoutStore;
  payments: FakeProvider;
  invoicing: FakeInvoicing;
  auth: MemoryAuthStore;
  /** The clock: `deps.now` reads it. */
  clock: { now: number };
  /** The shared calendar's entries, as `deps.booking` reports them. */
  calendar: Busy[];
  /** Plays the gateway and delivers its notification: the customer paid, or gave up. */
  settle(orderId: string, status: PaymentStatus): Promise<NotificationResult>;
  /** Delivers the notification for the order's payment as it stands. */
  notify(orderId: string): Promise<NotificationResult>;
}

export function studio(settings: Partial<CheckoutSettings> = {}): Studio {
  const store = new MemoryCheckoutStore();
  const payments = new FakeProvider();
  const invoicing = new FakeInvoicing();
  const auth = new MemoryAuthStore();
  const clock = { now: NOW };
  const calendar: Busy[] = [];
  const context = (): BookingContext => ({
    settings: DEFAULT_SETTINGS,
    calendar: [...calendar],
    technicians: [
      { id: 'libor', busy: [] },
      { id: 'nero', busy: [] },
    ],
  });
  const deps: CheckoutDeps = {
    store,
    payments,
    invoicing,
    auth,
    catalogue: CATALOGUE,
    settings: { ...DEFAULT_CHECKOUT_SETTINGS, orders: EXAMPLE_SETTINGS, auth: DEFAULT_AUTH_SETTINGS, ...settings },
    now: () => clock.now,
    booking: async () => context(),
    returnUrls: (orderId) => ({
      paid: `https://studio.example/orders/${orderId}?paid`,
      cancelled: `https://studio.example/orders/${orderId}?cancelled`,
      pending: `https://studio.example/orders/${orderId}?pending`,
    }),
    exchangeRate: async (currency) => (currency === 'EUR' ? '25.215' : undefined),
  };
  const paymentOf = (orderId: string): string => {
    const paymentId = store.checkouts.get(orderId)?.payment?.paymentId;
    if (!paymentId) throw new Error(`order ${orderId} has no payment`);
    return paymentId;
  };
  const notify = (orderId: string) => handlePaymentNotification(deps, payments.notification(paymentOf(orderId)));
  return {
    deps,
    store,
    payments,
    invoicing,
    auth,
    clock,
    calendar,
    notify,
    settle(orderId, status) {
      payments.settle(paymentOf(orderId), status);
      return notify(orderId);
    },
  };
}

/** The effects as short names, for comparing what a step asked for: `order-confirmed`, `studio-alert:slot-lost`. */
export const names = (effects: readonly Effect[]): string[] =>
  effects.map((effect) => (effect.type !== 'email' ? effect.type : effect.template === 'studio-alert' ? `studio-alert:${effect.data.problem}` : effect.template));
