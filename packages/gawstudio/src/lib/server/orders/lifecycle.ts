// An order's life as a pure state machine: which state may follow which, how long an order may sit in a state
// before the admin shows it as overdue, and how long its files are kept. Orders are plain data; every function
// returns a new order and changes nothing.
//
// Three flows share the states:
// - `classic`  draft → awaiting-payment → paid → awaiting-files → in-queue → in-progress → delivered → closed
// - `ai`       draft (files uploaded) → awaiting-payment → paid → ai-draft → review → delivered → closed, where
//              the technician's review may also re-run the draft (→ ai-draft), adjust it by hand (→ adjusting →
//              delivered) or convert the order to the classic service (→ in-queue, the flow becoming `classic`)
// - `recording` draft → awaiting-payment → paid → closed: a session is booked, nothing queues
// An unpaid order can be cancelled; a paid, undelivered or delivered one can be refunded; `closed`, `cancelled`
// and `refunded` are final.
import { addDays, pragueDate, startOfPragueDay } from './dates.ts';
import type { CalendarDate } from './dates.ts';

export const ORDER_STATES = [
  'draft',
  'awaiting-payment',
  'paid',
  'awaiting-files',
  'in-queue',
  'in-progress',
  'ai-draft',
  'review',
  'adjusting',
  'delivered',
  'closed',
  'cancelled',
  'refunded',
] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export const FLOWS = ['classic', 'ai', 'recording'] as const;
export type Flow = (typeof FLOWS)[number];

const UNPAID = { draft: ['awaiting-payment', 'cancelled'], 'awaiting-payment': ['paid', 'draft', 'cancelled'] } as const;

/** The states that may follow each state, per flow. A state not listed is final in that flow, or not part of it. */
export const TRANSITIONS: Record<Flow, Partial<Record<OrderState, readonly OrderState[]>>> = {
  classic: {
    ...UNPAID,
    // Files may already be there when the payment is confirmed.
    paid: ['awaiting-files', 'in-queue', 'refunded'],
    'awaiting-files': ['in-queue', 'refunded'],
    // Back to awaiting files when the upload turns out unusable.
    'in-queue': ['in-progress', 'awaiting-files', 'refunded'],
    'in-progress': ['delivered', 'in-queue', 'refunded'],
    delivered: ['closed', 'refunded'],
  },
  ai: {
    ...UNPAID,
    paid: ['ai-draft', 'refunded'],
    'ai-draft': ['review', 'refunded'],
    // Approve, re-run, adjust, or convert to the classic service.
    review: ['delivered', 'ai-draft', 'adjusting', 'in-queue', 'refunded'],
    adjusting: ['delivered', 'refunded'],
    delivered: ['closed', 'refunded'],
  },
  recording: {
    ...UNPAID,
    paid: ['closed', 'refunded'],
  },
};

export interface Order {
  id: string;
  flow: Flow;
  state: OrderState;
  /** When the order entered its state, an ISO instant. */
  stateSince: string;
  /** When it was (last) delivered, an ISO instant. */
  deliveredAt?: string;
  /** The delivery date the customer was shown, from the queue: the deadline of the work itself. */
  expectedDelivery?: CalendarDate;
  /** Every state the order has been in, oldest first. */
  history: { state: OrderState; at: string }[];
}

export interface OrderSettings {
  /** Hours an order may stay in a state before it is overdue, per flow. A state left out has no such limit. */
  deadlineHours: Record<Flow, Partial<Record<OrderState, number>>>;
  /** Days the files are kept after delivery. */
  retentionDays: number;
}

/**
 * Example settings; the 30 days of retention are the specification's, the hours are placeholders for the admin.
 * The work states (in-queue, in-progress, adjusting) have no hours: their deadline is the expected delivery date.
 */
export const EXAMPLE_SETTINGS: OrderSettings = {
  deadlineHours: {
    classic: { 'awaiting-payment': 72, paid: 24, 'awaiting-files': 168, delivered: 336 },
    ai: { 'awaiting-payment': 72, paid: 1, 'ai-draft': 2, review: 48, delivered: 336 },
    recording: { 'awaiting-payment': 72 },
  },
  retentionDays: 30,
};

const HOUR_MS = 3_600_000;

/** A new order, in `draft`. */
export function createOrder(id: string, flow: Flow, at: Date): Order {
  const since = at.toISOString();
  return { id, flow, state: 'draft', stateSince: since, history: [{ state: 'draft', at: since }] };
}

/** The states the order may move to now. */
export function nextStates(order: Pick<Order, 'flow' | 'state'>): readonly OrderState[] {
  return TRANSITIONS[order.flow][order.state] ?? [];
}

export function canTransition(order: Pick<Order, 'flow' | 'state'>, to: OrderState): boolean {
  return nextStates(order).includes(to);
}

/** Whether nothing can follow the order's state. */
export function isFinal(order: Pick<Order, 'flow' | 'state'>): boolean {
  return nextStates(order).length === 0;
}

export type TransitionResult = { ok: true; order: Order } | { ok: false; error: 'not-allowed' };

/**
 * Moves the order to a state, if its flow allows that. Delivery is stamped; an AI-assisted order sent from review
 * to the queue becomes a classic order (its price and load are then the caller's to requote).
 */
export function transition(order: Order, to: OrderState, at: Date): TransitionResult {
  if (!canTransition(order, to)) return { ok: false, error: 'not-allowed' };
  const since = at.toISOString();
  return {
    ok: true,
    order: {
      ...order,
      flow: order.flow === 'ai' && to === 'in-queue' ? 'classic' : order.flow,
      state: to,
      stateSince: since,
      ...(to === 'delivered' ? { deliveredAt: since } : {}),
      history: [...order.history, { state: to, at: since }],
    },
  };
}

/** The states whose deadline, without hours in the settings, is the expected delivery date. */
const WORK_STATES: readonly OrderState[] = ['in-queue', 'in-progress', 'ai-draft', 'review', 'adjusting'];

/**
 * When the order's current step is due: the state's hours from the settings, counted from entering the state, or
 * else, while it is being worked on, the end of its expected delivery date in Prague. `undefined`: no deadline.
 */
export function deadline(order: Order, settings: OrderSettings): Date | undefined {
  const hours = settings.deadlineHours[order.flow][order.state];
  if (hours !== undefined) return new Date(Date.parse(order.stateSince) + hours * HOUR_MS);
  if (order.expectedDelivery && WORK_STATES.includes(order.state)) return startOfPragueDay(addDays(order.expectedDelivery, 1));
  return undefined;
}

/** Whether the order has sat in its step past the deadline. A final order is never overdue. */
export function overdue(order: Order, settings: OrderSettings, now: Date): boolean {
  if (isFinal(order)) return false;
  const due = deadline(order, settings);
  return due !== undefined && now.getTime() > due.getTime();
}

/** The overdue orders for the admin, the longest overdue first. */
export function overdueOrders(orders: readonly Order[], settings: OrderSettings, now: Date): Order[] {
  return orders
    .filter((order) => overdue(order, settings, now))
    .sort((a, b) => deadline(a, settings)!.getTime() - deadline(b, settings)!.getTime());
}

/**
 * When the order's files may be deleted: they are kept for `retentionDays` whole Prague calendar days after the
 * day of delivery, so this is the Prague midnight that ends the last of them. `undefined` before delivery.
 */
export function retentionEnds(order: Pick<Order, 'deliveredAt'>, settings: Pick<OrderSettings, 'retentionDays'>): Date | undefined {
  if (!order.deliveredAt) return undefined;
  const delivered = pragueDate(new Date(order.deliveredAt));
  return startOfPragueDay(addDays(delivered, settings.retentionDays + 1));
}
