import { describe, expect, test } from 'bun:test';

import { EXAMPLE_CATALOGUE, techniciansFor } from './catalogue.ts';
import { effectiveLoad, estimateDelivery, estimateForAnyone, EXAMPLE_WORK_WEEK, queueOf, schedule } from './queue.ts';
import type { QueueEntry, QueueTechnician } from './queue.ts';
import { quote } from './quote.ts';

// Tuesday 24 November 2026, 11:00 in Prague. With 6000 a week over five days, a working day does 1200.
const NOW = new Date('2026-11-24T10:00:00Z');
const LIBOR: QueueTechnician = { id: 'libor', weeklyCapacity: 6000 };
const NERO: QueueTechnician = { id: 'nero', weeklyCapacity: 6000 };

const entry = (orderId: string, technician: string, load: number, adjustedLoad?: number): QueueEntry => ({
  orderId,
  technician,
  kind: 'mix',
  load,
  ...(adjustedLoad === undefined ? {} : { adjustedLoad }),
});

const dateFor = (load: number, queue: QueueEntry[] = [], technician = LIBOR, now = NOW, week = EXAMPLE_WORK_WEEK) =>
  estimateDelivery(technician, { queue, load, week, now })?.date;

describe('an empty queue', () => {
  test('one mix is done on the next working day', () => {
    expect(estimateDelivery(LIBOR, { queue: [], load: 1000, week: EXAMPLE_WORK_WEEK, now: NOW })).toEqual({
      technician: 'libor',
      date: '2026-11-25',
      loadAhead: 0,
      load: 1000,
    });
  });

  test('a day\'s capacity is the boundary', () => {
    expect(dateFor(1200)).toBe('2026-11-25');
    expect(dateFor(1201)).toBe('2026-11-26');
    expect(dateFor(3000)).toBe('2026-11-27');
    expect(dateFor(3600)).toBe('2026-11-27');
  });

  test('work that does not fit this week runs over the weekend into the next', () => {
    expect(dateFor(3601)).toBe('2026-11-30');
    expect(dateFor(4000)).toBe('2026-11-30');
    // Three days left this week, then a whole week and two days.
    expect(dateFor(12_000)).toBe('2026-12-08');
  });

  test('an order with no load still takes the next working day', () => {
    expect(dateFor(0)).toBe('2026-11-25');
    expect(dateFor(-5)).toBe('2026-11-25');
  });
});

describe('today', () => {
  test('is the Prague date, and is not counted', () => {
    // 23:30 UTC on Tuesday is Wednesday in Prague: work goes on on Thursday.
    expect(dateFor(1000, [], LIBOR, new Date('2026-11-24T23:30:00Z'))).toBe('2026-11-26');
    expect(dateFor(1000, [], LIBOR, new Date('2026-11-24T22:30:00Z'))).toBe('2026-11-25');
  });

  test('from Friday or the weekend the next working day is Monday', () => {
    expect(dateFor(1000, [], LIBOR, new Date('2026-11-27T09:00:00Z'))).toBe('2026-11-30');
    expect(dateFor(1000, [], LIBOR, new Date('2026-11-28T09:00:00Z'))).toBe('2026-11-30');
    expect(dateFor(1000, [], LIBOR, new Date('2026-11-29T09:00:00Z'))).toBe('2026-11-30');
  });

  test('the year turns', () => {
    expect(dateFor(2400, [], LIBOR, new Date('2026-12-30T09:00:00Z'))).toBe('2027-01-01');
    expect(dateFor(3600, [], LIBOR, new Date('2026-12-30T09:00:00Z'))).toBe('2027-01-04');
  });
});

describe('an existing queue', () => {
  const queue = [entry('a', 'libor', 3000), entry('b', 'nero', 9000), entry('c', 'libor', 2000)];

  test('a new order waits for the technician\'s own queue only', () => {
    expect(estimateDelivery(LIBOR, { queue, load: 1000, week: EXAMPLE_WORK_WEEK, now: NOW })).toEqual({
      technician: 'libor',
      date: '2026-12-01',
      loadAhead: 5000,
      load: 1000,
    });
    expect(queueOf(queue, 'libor').map((e) => e.orderId)).toEqual(['a', 'c']);
  });

  test('a load the technician adjusted counts instead of the quoted one', () => {
    expect(dateFor(1000, [entry('a', 'libor', 1000)])).toBe('2026-11-26');
    expect(dateFor(1000, [entry('a', 'libor', 1000, 3000)])).toBe('2026-11-30');
    expect(dateFor(1000, [entry('a', 'libor', 3000, 200)])).toBe('2026-11-25');
    expect(effectiveLoad(entry('a', 'libor', 1000, 0))).toBe(0);
    expect(effectiveLoad(entry('a', 'libor', 1000, -1))).toBe(0);
    expect(effectiveLoad(entry('a', 'libor', 1000))).toBe(1000);
  });

  test('the admin sees every queued order\'s date, in queue order', () => {
    expect(schedule(LIBOR, queue, EXAMPLE_WORK_WEEK, NOW).map((s) => [s.entry.orderId, s.date])).toEqual([
      ['a', '2026-11-27'],
      ['c', '2026-12-01'],
    ]);
    expect(schedule(NERO, queue, EXAMPLE_WORK_WEEK, NOW).map((s) => [s.entry.orderId, s.date])).toEqual([['b', '2026-12-04']]);
    expect(schedule(LIBOR, [], EXAMPLE_WORK_WEEK, NOW)).toEqual([]);
  });
});

describe('capacity', () => {
  test('a week off is skipped', () => {
    const away: QueueTechnician = { ...LIBOR, capacityByWeek: { '2026-11-30': 0 } };
    expect(dateFor(3600, [], away)).toBe('2026-11-27');
    expect(dateFor(4000, [], away)).toBe('2026-12-07');
  });

  test('a single week may have its own capacity', () => {
    const busy: QueueTechnician = { ...LIBOR, capacityByWeek: { '2026-11-23': 12_000 } };
    expect(dateFor(4000, [], busy)).toBe('2026-11-26');
    expect(dateFor(7200, [], busy)).toBe('2026-11-27');
    expect(dateFor(7201, [], busy)).toBe('2026-11-30');
  });

  test('a capacity that does not divide by the days is still exact', () => {
    // 1000 a week over three days: exactly a week of work is done on the third working day, not the fourth.
    const slow: QueueTechnician = { id: 'slow', weeklyCapacity: 1000 };
    const week = { workingDays: [1, 3, 5] };
    expect(dateFor(1000, [], slow, NOW, week)).toBe('2026-11-30');
    expect(dateFor(1001, [], slow, NOW, week)).toBe('2026-12-02');
    expect(dateFor(333, [], slow, NOW, week)).toBe('2026-11-25');
    expect(dateFor(334, [], slow, NOW, week)).toBe('2026-11-27');
  });

  test('the working week is a setting', () => {
    const sixDays = { workingDays: [1, 2, 3, 4, 5, 6] };
    expect(dateFor(4000, [], LIBOR, NOW, sixDays)).toBe('2026-11-28');
    expect(dateFor(1000, [], LIBOR, NOW, { workingDays: [7] })).toBe('2026-11-29');
  });

  test('without capacity or working days there is no date', () => {
    expect(dateFor(1000, [], { id: 'none', weeklyCapacity: 0 })).toBeUndefined();
    expect(dateFor(1000, [], LIBOR, NOW, { workingDays: [] })).toBeUndefined();
    expect(schedule({ id: 'libor', weeklyCapacity: 0 }, [entry('a', 'libor', 1)], EXAMPLE_WORK_WEEK, NOW)[0]!.date).toBeUndefined();
  });
});

describe('"anyone"', () => {
  const input = (queue: QueueEntry[], load = 1000) => ({ queue, load, week: EXAMPLE_WORK_WEEK, now: NOW });

  test('is whoever delivers first', () => {
    const queue = [entry('a', 'libor', 5000)];
    expect(estimateForAnyone([LIBOR, NERO], input(queue))).toEqual({ technician: 'nero', date: '2026-11-25', loadAhead: 0, load: 1000 });
    expect(estimateForAnyone([LIBOR], input(queue))?.technician).toBe('libor');
  });

  test('on the same date the shorter queue wins, then the order of the list', () => {
    expect(estimateForAnyone([LIBOR, NERO], input([entry('a', 'libor', 100)]))?.technician).toBe('nero');
    expect(estimateForAnyone([LIBOR, NERO], input([]))?.technician).toBe('libor');
    expect(estimateForAnyone([NERO, LIBOR], input([]))?.technician).toBe('nero');
  });

  test('a higher capacity can beat a shorter queue', () => {
    const fast: QueueTechnician = { id: 'fast', weeklyCapacity: 30_000 };
    const queue = [entry('a', 'fast', 5000), entry('b', 'libor', 2000)];
    expect(estimateForAnyone([LIBOR, fast], input(queue))).toMatchObject({ technician: 'fast', date: '2026-11-25' });
  });

  test('nobody able means no estimate', () => {
    expect(estimateForAnyone([], input([]))).toBeUndefined();
    expect(estimateForAnyone([{ id: 'none', weeklyCapacity: 0 }], input([]))).toBeUndefined();
  });

  test('a quote\'s work feeds the queue: ten masters by whoever is free first', () => {
    const result = quote(EXAMPLE_CATALOGUE, { currency: 'EUR', tracks: [{ service: 'mastering', technician: 'anyone', tracks: 10 }] });
    if (!result.ok) throw new Error('not priced');
    const [work] = result.quote.work;
    const candidates = techniciansFor(EXAMPLE_CATALOGUE, work!.service, 'EUR');
    const queue = [entry('a', 'libor', 6000)];
    // 10 masters weigh 4000: Risto, with nothing queued, is done on Monday; Libor has a week of work first.
    expect(estimateForAnyone(candidates, input(queue, work!.load))).toEqual({ technician: 'risto', date: '2026-11-30', loadAhead: 0, load: 4000 });
  });
});
