import { describe, expect, test } from 'bun:test';

import { blocksOn, DEFAULT_SETTINGS, settingsProblems } from './settings.ts';
import type { BookingSettings } from './settings.ts';

const ids = (date: string, settings: BookingSettings): string[] => blocksOn(date, settings).map((block) => `${block.id}${block.online ? '' : ' (off)'}`);

describe('the default settings', () => {
  test('are usable', () => {
    expect(settingsProblems(DEFAULT_SETTINGS)).toEqual([]);
  });

  test('two blocks online and the evening defined but off', () => {
    expect(ids('2026-06-01', DEFAULT_SETTINGS)).toEqual(['morning', 'afternoon', 'evening (off)']);
    expect(blocksOn('2026-06-01', DEFAULT_SETTINGS)[0]).toEqual({ id: 'morning', startMinutes: 540, endMinutes: 780, online: true });
  });
});

describe('the blocks of a day', () => {
  test('a block exists only on its days of the week', () => {
    const settings: BookingSettings = {
      ...DEFAULT_SETTINGS,
      blocks: [{ id: 'morning', start: '09:00', end: '13:00', weekdays: [1, 2, 3, 4, 5], online: true }],
    };
    expect(ids('2026-06-05', settings)).toEqual(['morning']);
    expect(ids('2026-06-06', settings)).toEqual([]);
  });

  test('a later version takes over on its day', () => {
    const settings: BookingSettings = {
      ...DEFAULT_SETTINGS,
      blocks: [
        ...DEFAULT_SETTINGS.blocks,
        { id: 'evening', start: '19:00', end: '23:00', weekdays: [6], online: true, validFrom: '2026-07-01' },
        { id: 'morning', start: '10:00', end: '14:00', weekdays: [1, 2, 3, 4, 5, 6, 7], online: true, validFrom: '2026-07-01' },
        { id: 'late', start: '20:00', end: '24:00', weekdays: [6], online: false, validFrom: '2026-08-01' },
      ],
    };
    expect(blocksOn('2026-06-30', settings)[0]?.startMinutes).toBe(540);
    expect(blocksOn('2026-07-01', settings)[0]?.startMinutes).toBe(600);
    // Tuesday 30 June: the evening is off every day; Saturday 4 July: on; Sunday 5 July: the new version has no Sunday.
    expect(ids('2026-06-30', settings)).toEqual(['morning', 'afternoon', 'evening (off)']);
    expect(ids('2026-07-04', settings)).toEqual(['morning', 'afternoon', 'evening']);
    expect(ids('2026-07-05', settings)).toEqual(['morning', 'afternoon']);
    expect(ids('2026-08-01', settings)).toEqual(['morning', 'afternoon', 'evening', 'late (off)']);
  });
});

describe('checking settings', () => {
  test('every mistake is named', () => {
    const problems = settingsProblems({
      ...DEFAULT_SETTINGS,
      timeZone: 'Europe/Nowhere',
      stepMinutes: 0,
      rehearsalBufferMinutes: -30,
      windowHours: { start: '20:00', end: '23:00' },
      blocks: [
        { id: 'a', start: '9', end: '13:00', weekdays: [1], online: true },
        { id: 'b', start: '13:00', end: '09:00', weekdays: [1], online: true },
        { id: 'c', start: '09:00', end: '11:00', weekdays: [0 as 1], online: true, validFrom: '1 July' },
        { id: 'd', start: '09:00', end: '13:00', weekdays: [1], online: true },
        { id: 'd', start: '10:00', end: '14:00', weekdays: [1], online: true },
      ],
    });
    expect(problems).toEqual([
      'Unknown time zone: Europe/Nowhere.',
      'The step must be a whole number, at least 1.',
      'The buffer around rehearsals must be a whole number, at least 0.',
      'The hours for free windows are shorter than the minimum length.',
      'Block "a": the times must be written HH:MM.',
      'Block "b": the end must be after the start.',
      'Block "c" is shorter than the minimum length.',
      'Block "c": the days must be 1 (Monday) to 7 (Sunday).',
      'Block "c": "valid from" must be a date written YYYY-MM-DD.',
      'Block "d" has two versions valid from the same day.',
    ]);
  });
});
