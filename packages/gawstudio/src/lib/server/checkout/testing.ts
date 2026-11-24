// What the checkout's tests share: a studio in memory, with the fake providers, a clock a test can move, and
// the customer's side of a payment played in one line.
import { DEFAULT_AUTH_SETTINGS, MemoryAuthStore } from '../auth/index.ts';
import { DEFAULT_SETTINGS } from '../booking/index.ts';
import type { BookingContext, BookingState, Busy } from '../booking/index.ts';
import { between } from '../booking/testing.ts';
import { D1CheckoutStore } from '../db/checkout-store.ts';
import { memoryD1 } from '../db/testing.ts';
import { FakeInvoicing } from '../invoicing/index.ts';
import { EXAMPLE_CATALOGUE, EXAMPLE_SETTINGS } from '../orders/index.ts';
import { FakeProvider } from '../payments/index.ts';
import type { PaymentStatus } from '../payments/index.ts';
import { handlePaymentNotification } from './notify.ts';
import { MemoryCheckoutStore } from './store.ts';
import type { CheckoutStore } from './store.ts';
import { DEFAULT_CHECKOUT_SETTINGS } from './types.ts';
import type { Checkout, CheckoutDeps, CheckoutRequest, CheckoutSettings, Effect, NotificationResult, SlotChoice } from './types.ts';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const NOW = Date.parse('2026-05-20T08:00:00Z');
export const DAY = '2026-06-01';

/** A slot of the studio's day, by its wall-clock times in Prague. */
export const slot = (start: string, end: string, technicianId: string | null = null, date = DAY): SlotChoice => ({ ...between(date, start, end), technicianId });

export const MORNING = slot('09:00', '13:00');


export const CUSTOMER = { email: 'name@example.com', name: 'Jane Doe', language: 'en' } as const;

export const recordingCart = (orderId: string, recording: SlotChoice = MORNING): CheckoutRequest => ({ orderId, customer: CUSTOMER, currency: 'CZK', recording });

export const tracksCart = (orderId: string, service = 'mix', tracks = 2): CheckoutRequest => ({
  orderId,
  customer: CUSTOMER,
  currency: 'EUR',
  tracks: [{ service, technician: 'libor', tracks }],
});

/** The stores the checkout's behaviour is tested on: the one in memory, and D1 (SQLite with the real migrations). */
export const STORES = ['memory', 'd1'] as const;
export type StoreKind = (typeof STORES)[number];

export interface Studio {
  deps: CheckoutDeps;
  store: CheckoutStore;
  /** The booking state as stored. */
  booking(): Promise<BookingState>;
  /** A stored checkout; throws when there is none. */
  checkout(orderId: string): Promise<Checkout>;
  /** How many checkouts are stored. */
  count(): Promise<number>;
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

export function studio(settings: Partial<CheckoutSettings> = {}, kind: StoreKind = 'memory', payments = new FakeProvider()): Studio {
  const memory = new MemoryCheckoutStore();
  const d1 = kind === 'd1' ? new D1CheckoutStore(memoryD1()) : undefined;
  const store: CheckoutStore = d1 ?? memory;
  const checkout = async (orderId: string): Promise<Checkout> => {
    const found = await store.get(orderId);
    if (!found) throw new Error(`no order ${orderId}`);
    return found;
  };
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
    catalogue: EXAMPLE_CATALOGUE,
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
  const paymentOf = async (orderId: string): Promise<string> => {
    const paymentId = (await checkout(orderId)).payment?.paymentId;
    if (!paymentId) throw new Error(`order ${orderId} has no payment`);
    return paymentId;
  };
  const notify = async (orderId: string) => handlePaymentNotification(deps, payments.notification(await paymentOf(orderId)));
  return {
    deps,
    store,
    booking: () => store.booking(),
    checkout,
    count: async () => (d1 ? d1.count() : memory.checkouts.size),
    payments,
    invoicing,
    auth,
    clock,
    calendar,
    notify,
    async settle(orderId, status) {
      payments.settle(await paymentOf(orderId), status);
      return notify(orderId);
    },
  };
}

/** The effects as short names, for comparing what a step asked for: `order-confirmed`, `studio-alert:slot-lost`. */
export const names = (effects: readonly Effect[]): string[] =>
  effects.map((effect) => (effect.type !== 'email' ? effect.type : effect.template === 'studio-alert' ? `studio-alert:${effect.data.problem}` : effect.template));
