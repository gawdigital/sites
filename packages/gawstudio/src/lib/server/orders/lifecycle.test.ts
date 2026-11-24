import { describe, expect, test } from 'bun:test';

import {
  canTransition,
  createOrder,
  deadline,
  EXAMPLE_SETTINGS,
  FLOWS,
  isFinal,
  nextStates,
  ORDER_STATES,
  overdue,
  overdueOrders,
  retentionEnds,
  transition,
} from './lifecycle.ts';
import type { Flow, Order, OrderState } from './lifecycle.ts';

const T0 = new Date('2026-11-24T10:00:00Z');
const hours = (n: number) => new Date(T0.getTime() + n * 3_600_000);

/** Every allowed transition, written out by hand: the table in the module is checked against this, pair by pair. */
const ALLOWED: Record<Flow, string[]> = {
  classic: [
    'draft > awaiting-payment',
    'draft > cancelled',
    'awaiting-payment > paid',
    'awaiting-payment > draft',
    'awaiting-payment > cancelled',
    'paid > awaiting-files',
    'paid > in-queue',
    'paid > refunded',
    'awaiting-files > in-queue',
    'awaiting-files > refunded',
    'in-queue > in-progress',
    'in-queue > awaiting-files',
    'in-queue > refunded',
    'in-progress > delivered',
    'in-progress > in-queue',
    'in-progress > refunded',
    'delivered > closed',
    'delivered > refunded',
  ],
  ai: [
    'draft > awaiting-payment',
    'draft > cancelled',
    'awaiting-payment > paid',
    'awaiting-payment > draft',
    'awaiting-payment > cancelled',
    'paid > ai-draft',
    'paid > refunded',
    'ai-draft > review',
    'ai-draft > refunded',
    'review > delivered',
    'review > ai-draft',
    'review > adjusting',
    'review > in-queue',
    'review > refunded',
    'adjusting > delivered',
    'adjusting > refunded',
    'delivered > closed',
    'delivered > refunded',
  ],
  recording: [
    'draft > awaiting-payment',
    'draft > cancelled',
    'awaiting-payment > paid',
    'awaiting-payment > draft',
    'awaiting-payment > cancelled',
    'paid > closed',
    'paid > refunded',
  ],
};

const order = (flow: Flow, state: OrderState, more: Partial<Order> = {}): Order => ({
  id: 'o1',
  flow,
  state,
  stateSince: T0.toISOString(),
  history: [{ state, at: T0.toISOString() }],
  ...more,
});

/** Walks an order through states, failing on the first step that is refused. */
function walk(start: Order, ...states: OrderState[]): Order {
  return states.reduce((o, to, i) => {
    const result = transition(o, to, hours(i + 1));
    if (!result.ok) throw new Error(`${o.state} > ${to} refused`);
    return result.order;
  }, start);
}

describe('transitions', () => {
  for (const flow of FLOWS) {
    test(`every pair of states in the ${flow} flow is allowed or refused as listed`, () => {
      for (const from of ORDER_STATES) {
        for (const to of ORDER_STATES) {
          const allowed = ALLOWED[flow].includes(`${from} > ${to}`);
          expect(`${from} > ${to}: ${canTransition({ flow, state: from }, to)}`).toBe(`${from} > ${to}: ${allowed}`);
          expect(transition(order(flow, from), to, hours(1)).ok).toBe(allowed);
        }
      }
    });
  }

  test('a refused transition says so and leaves the order alone', () => {
    const o = order('classic', 'draft');
    expect(transition(o, 'delivered', hours(1))).toEqual({ ok: false, error: 'not-allowed' });
    expect(o.state).toBe('draft');
  });

  test('closed, cancelled and refunded are final', () => {
    for (const flow of FLOWS) {
      for (const state of ['closed', 'cancelled', 'refunded'] as const) {
        expect(isFinal({ flow, state })).toBe(true);
        expect(nextStates({ flow, state })).toEqual([]);
      }
      expect(isFinal({ flow, state: 'draft' })).toBe(false);
    }
  });

  test('a classic order runs from draft to closed, keeping its history', () => {
    const start = createOrder('o1', 'classic', T0);
    expect(start).toEqual({ id: 'o1', flow: 'classic', state: 'draft', stateSince: T0.toISOString(), history: [{ state: 'draft', at: T0.toISOString() }] });

    const done = walk(start, 'awaiting-payment', 'paid', 'awaiting-files', 'in-queue', 'in-progress', 'delivered', 'closed');
    expect(done.state).toBe('closed');
    expect(done.stateSince).toBe(hours(7).toISOString());
    expect(done.deliveredAt).toBe(hours(6).toISOString());
    expect(done.history.map((h) => h.state)).toEqual(['draft', 'awaiting-payment', 'paid', 'awaiting-files', 'in-queue', 'in-progress', 'delivered', 'closed']);
    // The order passed in is not changed.
    expect(start.history).toHaveLength(1);
  });

  test('an AI-assisted order is approved, re-run or adjusted in review', () => {
    const inReview = walk(createOrder('o2', 'ai', T0), 'awaiting-payment', 'paid', 'ai-draft', 'review');
    expect(walk(inReview, 'delivered', 'closed').flow).toBe('ai');
    expect(walk(inReview, 'ai-draft', 'review', 'ai-draft', 'review', 'delivered').state).toBe('delivered');
    expect(walk(inReview, 'adjusting', 'delivered').deliveredAt).toBeDefined();
  });

  test('an AI-assisted order converted in review continues as a classic one', () => {
    const converted = walk(createOrder('o3', 'ai', T0), 'awaiting-payment', 'paid', 'ai-draft', 'review', 'in-queue');
    expect(converted).toMatchObject({ flow: 'classic', state: 'in-queue' });
    expect(walk(converted, 'in-progress', 'delivered', 'closed').state).toBe('closed');
    expect(canTransition(converted, 'review')).toBe(false);
  });

  test('a recording order closes once paid', () => {
    expect(walk(createOrder('o4', 'recording', T0), 'awaiting-payment', 'paid', 'closed').state).toBe('closed');
  });
});

describe('deadlines', () => {
  test('a step is due its hours after the order entered it', () => {
    const o = order('classic', 'awaiting-payment');
    expect(deadline(o, EXAMPLE_SETTINGS)).toEqual(hours(72));
    expect(overdue(o, EXAMPLE_SETTINGS, hours(72))).toBe(false);
    expect(overdue(o, EXAMPLE_SETTINGS, new Date(hours(72).getTime() + 1))).toBe(true);
  });

  test('the hours are the flow\'s own', () => {
    expect(deadline(order('ai', 'paid'), EXAMPLE_SETTINGS)).toEqual(hours(1));
    expect(deadline(order('classic', 'paid'), EXAMPLE_SETTINGS)).toEqual(hours(24));
    expect(deadline(order('ai', 'ai-draft'), EXAMPLE_SETTINGS)).toEqual(hours(2));
    expect(deadline(order('ai', 'review'), EXAMPLE_SETTINGS)).toEqual(hours(48));
  });

  test('the deadline restarts with each step', () => {
    const paid = walk(order('ai', 'awaiting-payment'), 'paid');
    expect(deadline(paid, EXAMPLE_SETTINGS)).toEqual(hours(2));
  });

  test('work without hours is due by the end of the expected delivery date in Prague', () => {
    const o = order('classic', 'in-progress', { expectedDelivery: '2026-12-01' });
    expect(deadline(o, EXAMPLE_SETTINGS)!.toISOString()).toBe('2026-12-01T23:00:00.000Z');
    expect(overdue(o, EXAMPLE_SETTINGS, new Date('2026-12-01T22:59:00Z'))).toBe(false);
    expect(overdue(o, EXAMPLE_SETTINGS, new Date('2026-12-01T23:00:01Z'))).toBe(true);
    expect(deadline(order('ai', 'adjusting', { expectedDelivery: '2026-12-01' }), EXAMPLE_SETTINGS)).toEqual(deadline(o, EXAMPLE_SETTINGS));
  });

  test('hours in the settings come before the expected date', () => {
    const settings = { ...EXAMPLE_SETTINGS, deadlineHours: { ...EXAMPLE_SETTINGS.deadlineHours, classic: { 'in-queue': 5 } } };
    expect(deadline(order('classic', 'in-queue', { expectedDelivery: '2026-12-01' }), settings)).toEqual(hours(5));
  });

  test('a step with neither has no deadline and is never overdue', () => {
    const o = order('classic', 'in-queue');
    expect(deadline(o, EXAMPLE_SETTINGS)).toBeUndefined();
    expect(overdue(o, EXAMPLE_SETTINGS, hours(100_000))).toBe(false);
    // The expected date is the work's deadline, not the payment's.
    expect(deadline(order('classic', 'draft', { expectedDelivery: '2026-12-01' }), EXAMPLE_SETTINGS)).toBeUndefined();
  });

  test('a final order is never overdue, whatever the settings say', () => {
    const settings = { ...EXAMPLE_SETTINGS, deadlineHours: { ...EXAMPLE_SETTINGS.deadlineHours, classic: { closed: 1 } } };
    expect(overdue(order('classic', 'closed'), settings, hours(10))).toBe(false);
  });

  test('the admin sees the overdue orders, the longest overdue first', () => {
    const orders = [
      order('classic', 'awaiting-payment', { id: 'waiting' }),
      order('ai', 'review', { id: 'review' }),
      order('ai', 'ai-draft', { id: 'draft' }),
      order('classic', 'closed', { id: 'closed' }),
    ];
    expect(overdueOrders(orders, EXAMPLE_SETTINGS, hours(1)).map((o) => o.id)).toEqual([]);
    expect(overdueOrders(orders, EXAMPLE_SETTINGS, hours(50)).map((o) => o.id)).toEqual(['draft', 'review']);
    expect(overdueOrders(orders, EXAMPLE_SETTINGS, hours(100)).map((o) => o.id)).toEqual(['draft', 'review', 'waiting']);
  });
});

describe('file retention', () => {
  test('files are kept 30 whole Prague days after the day of delivery', () => {
    const delivered = { deliveredAt: '2026-11-24T10:00:00.000Z' };
    expect(retentionEnds(delivered, EXAMPLE_SETTINGS)!.toISOString()).toBe('2026-12-24T23:00:00.000Z');
  });

  test('the day of delivery is Prague\'s, and the clock change in between does not shift the end', () => {
    // 23:30 UTC on the 9th is already the 10th in Prague.
    expect(retentionEnds({ deliveredAt: '2026-03-09T23:30:00.000Z' }, EXAMPLE_SETTINGS)!.toISOString()).toBe('2026-04-09T22:00:00.000Z');
  });

  test('the days are a setting', () => {
    expect(retentionEnds({ deliveredAt: '2026-11-24T10:00:00.000Z' }, { retentionDays: 7 })!.toISOString()).toBe('2026-12-01T23:00:00.000Z');
  });

  test('nothing is kept on a clock before delivery', () => {
    expect(retentionEnds(order('classic', 'in-progress'), EXAMPLE_SETTINGS)).toBeUndefined();
    const done = walk(order('classic', 'in-progress'), 'delivered', 'closed');
    expect(retentionEnds(done, EXAMPLE_SETTINGS)!.toISOString()).toBe('2026-12-24T23:00:00.000Z');
  });
});
