import { describe, expect, test } from 'bun:test';

import { availability, daySlots, freeTechnicians, isOffered, isStudioFree } from './availability.ts';
import type { Busy, Technician } from './availability.ts';
import { DEFAULT_SETTINGS } from './settings.ts';
import type { BookingSettings } from './settings.ts';
import { at, between, busy, span, spans } from './testing.ts';

// Monday 1 June 2026, looked at from mid-May: within the horizon, far beyond the lead time.
const DAY = '2026-06-01';
const NOW = Date.parse('2026-05-20T08:00:00Z');

const ANNA: Technician = { id: 'anna', busy: [] };
const BEN: Technician = { id: 'ben', busy: [] };
const TEAM = [ANNA, BEN];

const BLOCKS = ['block 09:00-13:00', 'wholeDay 09:00-18:00', 'block 14:00-18:00'];

function offered(studioBusy: readonly Busy[], settings: BookingSettings = DEFAULT_SETTINGS, date = DAY, technicians = TEAM) {
  const [result] = availability(date, settings, studioBusy, technicians, NOW);
  if (!result) throw new Error('no day');
  return result;
}

/** The starts of a day's window slots, each of the minimum length. */
const starts = (studioBusy: readonly Busy[], settings: BookingSettings = DEFAULT_SETTINGS): string[] => {
  const day = offered(studioBusy, settings);
  expect(day.slots.every((slot) => slot.kind === 'window' && slot.end - slot.start === settings.minimumMinutes * 60_000)).toBe(true);
  return day.slots.map((slot) => span(slot).slice(0, 5));
};

describe('a day untouched by rehearsals', () => {
  test('offers both blocks and the whole day', () => {
    const day = offered([]);
    expect(day.mode).toBe('blocks');
    expect(spans(day.slots)).toEqual(BLOCKS);
    expect(day.slots.map((slot) => slot.blockIds)).toEqual([['morning'], ['morning', 'afternoon'], ['afternoon']]);
    expect(day.freeWindows).toEqual([]);
    expect(day.slots[0]).toEqual({
      kind: 'block',
      date: DAY,
      start: Date.parse('2026-06-01T07:00:00Z'),
      end: Date.parse('2026-06-01T11:00:00Z'),
      blockIds: ['morning'],
      technicians: ['anna', 'ben'],
      anyone: true,
    });
  });

  test('the whole day is a setting', () => {
    expect(spans(offered([], { ...DEFAULT_SETTINGS, wholeDay: false }).slots)).toEqual(['block 09:00-13:00', 'block 14:00-18:00']);
  });

  test('the evening block is offered once it is switched on, and the whole day then takes all three', () => {
    const blocks = DEFAULT_SETTINGS.blocks.map((block) => ({ ...block, online: true }));
    expect(spans(offered([], { ...DEFAULT_SETTINGS, blocks }).slots)).toEqual([
      'block 09:00-13:00',
      'wholeDay 09:00-23:00',
      'block 14:00-18:00',
      'block 19:00-23:00',
    ]);
  });

  test('a single online block is not a whole day', () => {
    const blocks = DEFAULT_SETTINGS.blocks.map((block) => ({ ...block, online: block.id === 'morning' }));
    expect(spans(offered([], { ...DEFAULT_SETTINGS, blocks }).slots)).toEqual(['block 09:00-13:00']);
  });

  test('a booked block leaves the other: the lunch break is the hour between two sessions', () => {
    expect(spans(offered([busy('session', DAY, '09:00', '13:00')]).slots)).toEqual(['block 14:00-18:00']);
    expect(spans(offered([busy('session', DAY, '14:00', '18:00')]).slots)).toEqual(['block 09:00-13:00']);
  });

  test('a held block is taken like a booked one', () => {
    expect(spans(offered([busy('hold', DAY, '09:00', '13:00')]).slots)).toEqual(['block 14:00-18:00']);
  });

  test('a booked whole day leaves nothing', () => {
    expect(offered([busy('session', DAY, '09:00', '18:00')]).slots).toEqual([]);
  });

  test('a session that leaves less than an hour before a block takes it, without breaking the day', () => {
    const day = offered([busy('session', DAY, '05:00', '08:30')]);
    expect(day.mode).toBe('blocks');
    expect(spans(day.slots)).toEqual(['block 14:00-18:00']);
    expect(spans(offered([busy('session', DAY, '05:00', '08:00')]).slots)).toEqual(BLOCKS);
  });

  test('a rehearsal in the evening only leaves the day as it is', () => {
    const day = offered([busy('calendar', DAY, '19:00', '22:00')]);
    expect(day.mode).toBe('blocks');
    expect(spans(day.slots)).toEqual(BLOCKS);
  });

  test('a rehearsal exactly half an hour after the last block, or before the first, does not touch it', () => {
    expect(spans(offered([busy('calendar', DAY, '18:30', '22:00')]).slots)).toEqual(BLOCKS);
    expect(spans(offered([busy('calendar', DAY, '06:00', '08:30')]).slots)).toEqual(BLOCKS);
  });

  test('sessions of the days around do not reach into it', () => {
    expect(spans(offered([busy('session', '2026-05-31', '14:00', '18:00'), busy('calendar', '2026-06-02', '09:00', '12:00')]).slots)).toEqual(BLOCKS);
  });

  test('an entry without length blocks nothing', () => {
    expect(spans(offered([busy('calendar', DAY, '10:00', '10:00')]).slots)).toEqual(BLOCKS);
  });
});

describe('a day broken by a rehearsal', () => {
  test('a rehearsal in the morning: windows from half an hour after it, every half hour, to the last that ends by 23:00', () => {
    const day = offered([busy('calendar', DAY, '10:00', '12:00')]);
    expect(day.mode).toBe('windows');
    expect(spans(day.slots).slice(0, 2)).toEqual(['window 12:30-16:30', 'window 13:00-17:00']);
    expect(spans(day.slots).at(-1)).toBe('window 19:00-23:00');
    expect(day.slots).toHaveLength(14);
    expect(day.slots.every((slot) => slot.blockIds.length === 0)).toBe(true);
    expect(day.freeWindows.map(span)).toEqual(['12:30-23:00']);
  });

  test('a rehearsal that starts within half an hour of the last block breaks the day', () => {
    const rehearsal = [busy('calendar', DAY, '18:15', '22:00')];
    expect(offered(rehearsal).mode).toBe('windows');
    // The session must end by 17:45, and starts on the half hour: 13:30 is the last.
    expect(starts(rehearsal)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30']);
    expect(offered(rehearsal).freeWindows.map(span)).toEqual(['09:00-17:30']);
  });

  test('a window may span the lunch break: between two rehearsals, 11:00-15:00', () => {
    const day = offered([busy('calendar', DAY, '09:00', '10:30'), busy('calendar', DAY, '15:30', '18:00')]);
    expect(spans(day.slots)).toEqual(['window 11:00-15:00', 'window 18:30-22:30', 'window 19:00-23:00']);
    expect(day.freeWindows.map(span)).toEqual(['11:00-15:00', '18:30-23:00']);
  });

  test('a gap a quarter of an hour too short is not a window', () => {
    expect(starts([busy('calendar', DAY, '09:00', '10:30'), busy('calendar', DAY, '15:15', '23:00')])).toEqual([]);
  });

  test('windows start on the hour or half hour, whenever the rehearsal ends', () => {
    expect(starts([busy('calendar', DAY, '09:00', '10:40')])[0]).toBe('11:30');
    expect(starts([busy('calendar', DAY, '09:00', '10:30')])[0]).toBe('11:00');
  });

  test('windows keep within the window hours, with no buffer at their edges', () => {
    const all = starts([busy('calendar', DAY, '13:30', '14:30')]);
    expect(all).toEqual(['09:00', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00']);
  });

  test('an hour is kept between a window and a recording session, on both sides', () => {
    // A rehearsal early, a session 12:00-16:00 booked as a window earlier.
    const taken = [busy('calendar', DAY, '08:00', '09:30'), busy('session', DAY, '12:00', '16:00')];
    expect(starts(taken)).toEqual(['17:00', '17:30', '18:00', '18:30', '19:00']);
    const later = [busy('calendar', DAY, '08:00', '09:30'), busy('session', DAY, '15:00', '19:00')];
    expect(starts(later)).toEqual(['10:00']);
    expect(starts([busy('calendar', DAY, '08:00', '09:30'), busy('hold', DAY, '15:00', '19:00')])).toEqual(['10:00']);
  });

  test('the step, the minimum, the buffers and the hours are settings', () => {
    const rehearsal = [busy('calendar', DAY, '12:00', '13:00')];
    const settings: BookingSettings = {
      ...DEFAULT_SETTINGS,
      stepMinutes: 60,
      minimumMinutes: 180,
      rehearsalBufferMinutes: 60,
      windowHours: { start: '08:00', end: '18:00' },
    };
    expect(starts(rehearsal, settings)).toEqual(['08:00', '14:00', '15:00']);
  });

  test('a day with no online block stays closed, rehearsal or not', () => {
    const blocks = DEFAULT_SETTINGS.blocks.map((block) => ({ ...block, weekdays: [2, 3, 4, 5] as const }));
    const day = offered([busy('calendar', DAY, '10:00', '12:00')], { ...DEFAULT_SETTINGS, blocks });
    expect(day).toEqual({ date: DAY, mode: 'closed', slots: [], freeWindows: [] });
  });
});

describe('technicians', () => {
  const morningOff: Technician = { id: 'anna', busy: [between(DAY, '08:00', '12:00')] };

  test('each slot lists who is free for all of it', () => {
    const day = offered([], DEFAULT_SETTINGS, DAY, [morningOff, BEN]);
    expect(day.slots.map((slot) => [slot.kind, slot.technicians, slot.anyone])).toEqual([
      ['block', ['ben'], true],
      ['wholeDay', ['ben'], true],
      ['block', ['anna', 'ben'], true],
    ]);
    const [morning] = day.slots;
    expect(morning && isOffered(morning, null)).toBe(true);
    expect(morning && isOffered(morning, 'ben')).toBe(true);
    expect(morning && isOffered(morning, 'anna')).toBe(false);
  });

  test('a slot nobody is free for is listed, and offered to no one', () => {
    const day = offered([], DEFAULT_SETTINGS, DAY, [morningOff]);
    expect(day.slots.map((slot) => [slot.kind, slot.technicians, slot.anyone])).toEqual([
      ['block', [], false],
      ['wholeDay', [], false],
      ['block', ['anna'], true],
    ]);
    expect(offered([], DEFAULT_SETTINGS, DAY, []).slots.every((slot) => !slot.anyone)).toBe(true);
  });

  test('busy time that ends as the slot starts does not collide, unless the technicians have a buffer', () => {
    const until9: Technician = { id: 'anna', busy: [between(DAY, '07:00', '09:00'), between(DAY, '13:00', '13:30')] };
    expect(freeTechnicians(between(DAY, '09:00', '13:00'), [until9], DEFAULT_SETTINGS)).toEqual(['anna']);
    expect(freeTechnicians(between(DAY, '09:00', '13:00'), [until9], { ...DEFAULT_SETTINGS, technicianBufferMinutes: 15 })).toEqual([]);
  });

  test('windows list technicians too', () => {
    const afternoonOff: Technician = { id: 'ben', busy: [between(DAY, '16:00', '17:00')] };
    const day = offered([busy('calendar', DAY, '08:00', '11:30')], DEFAULT_SETTINGS, DAY, [ANNA, afternoonOff]);
    expect(day.slots.filter((slot) => slot.technicians.includes('ben')).map((slot) => span(slot))).toEqual(['12:00-16:00', '17:00-21:00', '17:30-21:30', '18:00-22:00', '18:30-22:30', '19:00-23:00']);
    expect(day.slots.every((slot) => slot.technicians.includes('anna'))).toBe(true);
  });
});

describe('buffers', () => {
  test('adjacent intervals: the buffer is exact to the minute', () => {
    const block = between(DAY, '14:00', '18:00');
    expect(isStudioFree(block, [busy('session', DAY, '09:00', '13:00')], DEFAULT_SETTINGS)).toBe(true);
    expect(isStudioFree(block, [{ start: at(DAY, '09:00'), end: at(DAY, '13:00') + 60_000, kind: 'session' }], DEFAULT_SETTINGS)).toBe(false);
    expect(isStudioFree(block, [busy('calendar', DAY, '12:00', '13:30')], DEFAULT_SETTINGS)).toBe(true);
    expect(isStudioFree(block, [busy('calendar', DAY, '12:00', '13:31')], DEFAULT_SETTINGS)).toBe(false);
    expect(isStudioFree(block, [busy('calendar', DAY, '18:30', '20:00')], DEFAULT_SETTINGS)).toBe(true);
    expect(isStudioFree(block, [busy('calendar', DAY, '18:29', '20:00')], DEFAULT_SETTINGS)).toBe(false);
    expect(isStudioFree(block, [busy('session', DAY, '18:59', '23:00')], DEFAULT_SETTINGS)).toBe(false);
    expect(isStudioFree(block, [busy('session', DAY, '19:00', '23:00')], DEFAULT_SETTINGS)).toBe(true);
  });
});

describe('now, lead time and horizon', () => {
  test('a slot is offered only when it starts the lead time ahead', () => {
    const now = at('2026-05-31', '10:00');
    const [day] = availability(DAY, DEFAULT_SETTINGS, [], TEAM, now);
    expect(spans(day?.slots ?? [])).toEqual(['block 14:00-18:00']);
    const [exact] = availability(DAY, DEFAULT_SETTINGS, [], TEAM, at('2026-05-31', '09:00'));
    expect(spans(exact?.slots ?? [])).toEqual(BLOCKS);
  });

  test('windows that start too soon are dropped, and the free windows follow', () => {
    const now = at(DAY, '08:00');
    const [day] = availability(DAY, { ...DEFAULT_SETTINGS, leadTimeMinutes: 480 }, [busy('calendar', DAY, '09:00', '10:00')], TEAM, now);
    expect(day?.freeWindows.map(span)).toEqual(['16:00-23:00']);
  });

  test('the past and the days beyond the horizon are closed', () => {
    const days = availability({ from: '2026-05-19', to: '2026-05-20' }, DEFAULT_SETTINGS, [], TEAM, NOW);
    expect(days.map((day) => [day.date, day.mode, day.slots.length])).toEqual([
      ['2026-05-19', 'closed', 0],
      ['2026-05-20', 'blocks', 0],
    ]);
    const far = availability({ from: '2026-08-18', to: '2026-08-19' }, DEFAULT_SETTINGS, [], TEAM, NOW);
    expect(far.map((day) => [day.date, day.mode, day.slots.length])).toEqual([
      ['2026-08-18', 'blocks', 3],
      ['2026-08-19', 'closed', 0],
    ]);
  });

  test('today is the studio’s day, not the UTC one', () => {
    // 23:30 UTC on 31 May is already 1 June in Prague.
    const now = Date.parse('2026-05-31T23:30:00Z');
    const [yesterday] = availability('2026-05-31', { ...DEFAULT_SETTINGS, leadTimeMinutes: 0 }, [], TEAM, now);
    expect(yesterday?.mode).toBe('closed');
    const [today] = availability(DAY, { ...DEFAULT_SETTINGS, leadTimeMinutes: 0 }, [], TEAM, now);
    expect(today?.slots).toHaveLength(3);
  });

  test('a range gives each of its days, each by its own rules', () => {
    const days = availability({ from: DAY, to: '2026-06-03' }, DEFAULT_SETTINGS, [busy('calendar', '2026-06-02', '10:00', '12:00')], TEAM, NOW);
    expect(days.map((day) => [day.date, day.mode])).toEqual([
      [DAY, 'blocks'],
      ['2026-06-02', 'windows'],
      ['2026-06-03', 'blocks'],
    ]);
  });

  test('a new version of a block applies from its day', () => {
    const settings: BookingSettings = {
      ...DEFAULT_SETTINGS,
      blocks: [...DEFAULT_SETTINGS.blocks, { id: 'morning', start: '08:30', end: '12:30', weekdays: [1, 2, 3, 4, 5, 6, 7], online: true, validFrom: '2026-07-01' }],
    };
    expect(spans(offered([], settings, '2026-06-30').slots)[0]).toBe('block 09:00-13:00');
    expect(spans(offered([], settings, '2026-07-01').slots)[0]).toBe('block 08:30-12:30');
  });
});

describe('the days the clocks change', () => {
  const iso = (instant: number): string => new Date(instant).toISOString();

  test('the last Sunday of March: the blocks are at their wall-clock times, four hours long', () => {
    const now = Date.parse('2026-03-01T08:00:00Z');
    const [day] = availability('2026-03-29', DEFAULT_SETTINGS, [], TEAM, now);
    expect(spans(day?.slots ?? [])).toEqual(BLOCKS);
    expect(day?.slots.map((slot) => `${iso(slot.start)} ${iso(slot.end)}`)).toEqual([
      '2026-03-29T07:00:00.000Z 2026-03-29T11:00:00.000Z',
      '2026-03-29T07:00:00.000Z 2026-03-29T16:00:00.000Z',
      '2026-03-29T12:00:00.000Z 2026-03-29T16:00:00.000Z',
    ]);
    const [before] = availability('2026-03-28', DEFAULT_SETTINGS, [], TEAM, now);
    expect(iso(before?.slots[0]?.start ?? 0)).toBe('2026-03-28T08:00:00.000Z');
  });

  test('the last Sunday of October: the same, an hour later in UTC than the day before', () => {
    const now = Date.parse('2026-10-01T08:00:00Z');
    const [day] = availability('2026-10-25', DEFAULT_SETTINGS, [], TEAM, now);
    expect(day?.slots.map((slot) => `${iso(slot.start)} ${iso(slot.end)}`)).toEqual([
      '2026-10-25T08:00:00.000Z 2026-10-25T12:00:00.000Z',
      '2026-10-25T08:00:00.000Z 2026-10-25T17:00:00.000Z',
      '2026-10-25T13:00:00.000Z 2026-10-25T17:00:00.000Z',
    ]);
    const [before] = availability('2026-10-24', DEFAULT_SETTINGS, [], TEAM, now);
    expect(iso(before?.slots[0]?.start ?? 0)).toBe('2026-10-24T07:00:00.000Z');
  });

  test('windows on both days start on the wall clock’s half hours', () => {
    for (const [date, firstStart] of [['2026-03-29', '2026-03-29T10:30:00.000Z'], ['2026-10-25', '2026-10-25T11:30:00.000Z']] as const) {
      const rehearsal: Busy = { start: Date.parse(`${date}T09:00:00Z`), end: at(date, '12:00'), kind: 'calendar' };
      const day = daySlots(date, DEFAULT_SETTINGS, [rehearsal], TEAM);
      expect(day.mode).toBe('windows');
      expect(iso(day.slots[0]?.start ?? 0)).toBe(firstStart);
      expect(spans(day.slots)[0]).toBe('window 12:30-16:30');
      expect(day.slots).toHaveLength(14);
      expect(day.slots.every((slot) => slot.end - slot.start === 4 * 3_600_000)).toBe(true);
    }
  });

  test('a rehearsal the evening before a change day stays in its own day', () => {
    const [day] = availability('2026-03-29', DEFAULT_SETTINGS, [busy('calendar', '2026-03-28', '19:00', '23:30')], TEAM, Date.parse('2026-03-01T08:00:00Z'));
    expect(spans(day?.slots ?? [])).toEqual(BLOCKS);
  });
});
