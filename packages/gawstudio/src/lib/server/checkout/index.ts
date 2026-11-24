// The checkout of G.A.W.Studio (issue #29): the use cases that put the orders, the booking, the payments, the
// invoicing and the accounts together. Groundwork: no routes, no database, no mail. Everything outside comes in
// as `CheckoutDeps`; every e-mail goes out as data in a list of effects.
//
// - `startCheckout`: a cart becomes an order with a held slot (recording) and a payment to be sent to.
// - `handlePaymentNotification`: what the provider's notification does to the order, any number of times.
// - `sweep`: the scheduled pass over what ran out or was left unfinished.
// - `checkoutReport`: the one check of the settings across the modules, the payment's expiry against the hold's.
//
// Calls for one order are kept apart by the store's versioned `save`; calls on the booking state by its
// `updateBooking`. Every `now` is in epoch milliseconds.
export { startCheckout } from './start.ts';
export { handlePaymentNotification } from './notify.ts';
export { sweep } from './sweep.ts';
export { checkoutReport } from './settings.ts';
export type { CheckoutReport } from './settings.ts';
export { isUnfinished, MemoryCheckoutStore } from './store.ts';
export type { CheckoutStore } from './store.ts';
export { DEFAULT_CHECKOUT_SETTINGS, LANGUAGES } from './types.ts';
export type {
  AlertProblem,
  Amount,
  Checkout,
  CheckoutDeps,
  CheckoutRequest,
  CheckoutSettings,
  Customer,
  Effect,
  Email,
  HeldSlot,
  InvoiceStep,
  Language,
  NotificationResult,
  Problem,
  Recipient,
  Refund,
  Settlement,
  SlotChoice,
  StartResult,
  SweepResult,
  Unsettled,
} from './types.ts';
