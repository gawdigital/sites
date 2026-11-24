import { describe, expect, test } from 'bun:test';

import { availability } from './availability.ts';
import type { Technician } from './availability.ts';
import { assignTechnician, busyOf, confirm, confirmLate, EMPTY_STATE, expire, hold, nextExpiry, release } from './holds.ts';
import type { BookingContext, BookingState, HoldRequest } from './holds.ts';
import { DEFAULT_SETTINGS } from './settings.ts';
import { at, between, busy, spans } from './testing.ts';

const DAY = '2026-06-01';
const NOW = Date.parse('2026-05-20T08:00:00Z');
const MINUTE = 60_000;
const HELD_FOR = DEFAULT_SETTINGS.holdMinutes * MINUTE;

const ANNA: Technician = { id: 'anna', busy: [] };
const BEN: Technician = { id: 'ben', busy: [] };
const CONTEXT: BookingContext = { settings: DEFAULT_SETTINGS, calendar: [], technicians: [ANNA, BEN] };

const MORNING = between(DAY, '09:00', '13:00');
const AFTERNOON = between(DAY, '14:00', '18:00');
const WHOLE_DAY = between(DAY, '09:00', '18:00');

const request = (id: string, slot = MORNING, technicianId: string | null = null): HoldRequest => ({ id, ...slot, technicianId });

/** A state after the given holds, each made a second after the one before; every one must succeed. */
function held(requests: readonly HoldRequest[], context = CONTEXT, from: BookingState = EMPTY_STATE): BookingState {
  return requests.reduce((state, each, i) => {
    const result = hold(state, each, context, NOW + i * 1000);
    if (!result.ok) throw new Error(`hold ${each.id} refused: ${result.reason}`);
    return result.state;
  }, from);
}

/** A state with the given holds confirmed straight away. */
function booked(requests: readonly HoldRequest[], context = CONTEXT): BookingState {
  return requests.reduce((state, each) => {
    const result = confirm(held([each], context, state), each.id, context, NOW);
    if (!result.ok) throw new Error(`confirm ${each.id} refused: ${result.reason}`);
    return result.state;
  }, EMPTY_STATE);
}

const offered = (state: BookingState, now = NOW, context = CONTEXT): string[] =>
  spans(availability(DAY, context.settings, busyOf(state, context, now), context.technicians, now)[0]?.slots ?? []);

describe('holding a slot', () => {
  test('an offered slot is held for the hold time', () => {
    const result = hold(EMPTY_STATE, request('a'), CONTEXT, NOW);
    expect(result).toEqual({
      ok: true,
      state: { holds: [{ id: 'a', ...MORNING, technicianId: null, createdAt: NOW, expiresAt: NOW + HELD_FOR }], sessions: [] },
      hold: { id: 'a', ...MORNING, technicianId: null, createdAt: NOW, expiresAt: NOW + HELD_FOR },
    });
    expect(EMPTY_STATE).toEqual({ holds: [], sessions: [] });
  });

  test('the hold time is a setting', () => {
    const result = hold(EMPTY_STATE, request('a'), { ...CONTEXT, settings: { ...DEFAULT_SETTINGS, holdMinutes: 3 } }, NOW);
    expect(result.ok && result.hold.expiresAt - NOW).toBe(3 * MINUTE);
  });

  test('a held slot is no longer offered, and cannot be held twice', () => {
    const state = held([request('a')]);
    expect(offered(state)).toEqual(['block 14:00-18:00']);
    expect(hold(state, request('b'), CONTEXT, NOW + 1000)).toEqual({ ok: false, state, reason: 'unavailable' });
    expect(hold(state, request('b', MORNING, 'ben'), CONTEXT, NOW + 1000)).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  test('a held block takes the whole day with it, and a held whole day both blocks', () => {
    expect(hold(held([request('a')]), request('b', WHOLE_DAY), CONTEXT, NOW)).toMatchObject({ ok: false, reason: 'unavailable' });
    const day = held([request('a', WHOLE_DAY)]);
    expect(offered(day)).toEqual([]);
    expect(hold(day, request('b', AFTERNOON), CONTEXT, NOW)).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  test('the other block can be held by someone else meanwhile', () => {
    const state = held([request('a'), request('b', AFTERNOON)]);
    expect(state.holds.map((each) => each.id)).toEqual(['a', 'b']);
    expect(offered(state)).toEqual([]);
  });

  test('only what is offered can be held: not a part of a block, a shifted one, the evening, or nonsense', () => {
    const refused = (start: string, end: string) => hold(EMPTY_STATE, request('a', between(DAY, start, end)), CONTEXT, NOW);
    expect(refused('09:00', '11:00')).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(refused('10:00', '14:00')).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(refused('19:00', '23:00')).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(hold(EMPTY_STATE, request('a', { start: Number.NaN, end: MORNING.end }), CONTEXT, NOW)).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(hold(EMPTY_STATE, request('a', { start: MORNING.end, end: MORNING.start }), CONTEXT, NOW)).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  test('a slot inside the lead time or beyond the horizon is refused', () => {
    expect(hold(EMPTY_STATE, request('a'), CONTEXT, at('2026-05-31', '09:01'))).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(hold(EMPTY_STATE, request('a', between('2026-09-01', '09:00', '13:00')), CONTEXT, NOW)).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  test('on a day broken by a rehearsal a free window is held, and the next session keeps an hour from it', () => {
    const context: BookingContext = { ...CONTEXT, calendar: [busy('calendar', DAY, '08:00', '10:00')] };
    expect(hold(EMPTY_STATE, request('a'), context, NOW)).toMatchObject({ ok: false, reason: 'unavailable' });
    const state = held([request('a', between(DAY, '10:30', '14:30'))], context);
    expect(offered(state, NOW, context)[0]).toBe('window 15:30-19:30');
    expect(hold(state, request('b', between(DAY, '15:00', '19:00')), context, NOW)).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(hold(state, request('b', between(DAY, '15:30', '19:30')), context, NOW)).toMatchObject({ ok: true });
  });

  test('the technician picked must exist and be free; anyone needs one free', () => {
    const away: Technician = { id: 'anna', busy: [between(DAY, '08:00', '12:00')] };
    const context: BookingContext = { ...CONTEXT, technicians: [away, BEN] };
    expect(hold(EMPTY_STATE, request('a', MORNING, 'carl'), context, NOW)).toMatchObject({ ok: false, reason: 'unknown-technician' });
    expect(hold(EMPTY_STATE, request('a', MORNING, 'anna'), context, NOW)).toMatchObject({ ok: false, reason: 'technician-unavailable' });
    expect(hold(EMPTY_STATE, request('a', MORNING, 'ben'), context, NOW)).toMatchObject({ ok: true });
    expect(hold(EMPTY_STATE, request('a', MORNING, null), context, NOW)).toMatchObject({ ok: true });
    expect(hold(EMPTY_STATE, request('a', MORNING, null), { ...context, technicians: [away] }, NOW)).toMatchObject({ ok: false, reason: 'technician-unavailable' });
  });

  test('the same request again returns the hold as it is; the id for something else is refused', () => {
    const state = held([request('a')]);
    const again = hold(state, request('a'), CONTEXT, NOW + MINUTE);
    expect(again.ok && again.hold.expiresAt).toBe(NOW + HELD_FOR);
    expect(again.state).toBe(state);
    expect(hold(state, request('a', AFTERNOON), CONTEXT, NOW)).toMatchObject({ ok: false, reason: 'duplicate-id' });
    expect(hold(booked([request('a')]), request('a', AFTERNOON), CONTEXT, NOW)).toMatchObject({ ok: false, reason: 'duplicate-id' });
  });
});

describe('expiry and release', () => {
  test('a hold counts until its last millisecond, then the slot is free again', () => {
    const state = held([request('a')]);
    expect(expire(state, NOW + HELD_FOR - 1)).toBe(state);
    expect(expire(state, NOW + HELD_FOR)).toEqual(EMPTY_STATE);
    expect(offered(state, NOW + HELD_FOR - 1)).toEqual(['block 14:00-18:00']);
    expect(offered(state, NOW + HELD_FOR)).toHaveLength(3);
  });

  test('a slot whose hold ran out can be held by the next customer, before anything cleared the old hold', () => {
    const state = held([request('a')]);
    const result = hold(state, request('b'), CONTEXT, NOW + HELD_FOR);
    expect(result.ok && result.state.holds.map((each) => each.id)).toEqual(['b']);
  });

  test('only the holds that ran out are dropped', () => {
    const state = held([request('a')]);
    const later = hold(state, request('b', AFTERNOON), CONTEXT, NOW + 5 * MINUTE).state;
    expect(nextExpiry(later)).toBe(NOW + HELD_FOR);
    const after = expire(later, NOW + HELD_FOR);
    expect(after.holds.map((each) => each.id)).toEqual(['b']);
    expect(nextExpiry(after)).toBe(NOW + 5 * MINUTE + HELD_FOR);
    expect(nextExpiry(EMPTY_STATE)).toBeUndefined();
  });

  test('releasing frees the slot at once; an unknown id changes nothing', () => {
    const state = held([request('a')]);
    expect(release(state, 'b')).toBe(state);
    const freed = release(state, 'a');
    expect(freed).toEqual(EMPTY_STATE);
    expect(offered(freed)).toHaveLength(3);
  });

  test('sessions outlive expiry and release', () => {
    const state = booked([request('a')]);
    expect(expire(state, NOW + 10 * HELD_FOR)).toBe(state);
    expect(release(state, 'a')).toBe(state);
  });
});

describe('confirming', () => {
  test('a paid hold becomes a session, and the slot stays taken for good', () => {
    const state = held([request('a', MORNING, 'ben')]);
    const result = confirm(state, 'a', CONTEXT, NOW + MINUTE);
    expect(result).toEqual({
      ok: true,
      state: { holds: [], sessions: [{ id: 'a', ...MORNING, technicianId: 'ben', confirmedAt: NOW + MINUTE }] },
      session: { id: 'a', ...MORNING, technicianId: 'ben', confirmedAt: NOW + MINUTE },
    });
    expect(offered(result.state, NOW + 10 * HELD_FOR)).toEqual(['block 14:00-18:00']);
    expect(hold(result.state, request('b'), CONTEXT, NOW + 10 * HELD_FOR)).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  test('one slot cannot be paid twice: the second customer never gets a hold to confirm', () => {
    const state = held([request('a')]);
    const second = hold(state, request('b'), CONTEXT, NOW);
    expect(second.ok).toBe(false);
    expect(confirm(second.state, 'b', CONTEXT, NOW)).toMatchObject({ ok: false, reason: 'not-found' });
    expect(confirm(second.state, 'a', CONTEXT, NOW)).toMatchObject({ ok: true });
  });

  test('confirming again returns the same session and changes nothing', () => {
    const first = confirm(held([request('a')]), 'a', CONTEXT, NOW + MINUTE);
    const again = confirm(first.state, 'a', CONTEXT, NOW + HELD_FOR * 3);
    expect(again.state).toBe(first.state);
    expect(again.ok && first.ok && again.session).toBe(first.ok && first.session);
  });

  test('after the time-out it is too late, and the hold is gone', () => {
    const state = held([request('a')]);
    expect(confirm(state, 'a', CONTEXT, NOW + HELD_FOR - 1)).toMatchObject({ ok: true });
    const late = confirm(state, 'a', CONTEXT, NOW + HELD_FOR);
    expect(late).toEqual({ ok: false, state: EMPTY_STATE, reason: 'expired' });
    expect(confirm(late.state, 'a', CONTEXT, NOW + HELD_FOR)).toMatchObject({ ok: false, reason: 'not-found' });
  });

  test('a released or unknown hold cannot be confirmed', () => {
    const state = held([request('a')]);
    expect(confirm(release(state, 'a'), 'a', CONTEXT, NOW)).toMatchObject({ ok: false, reason: 'not-found' });
    expect(confirm(state, 'b', CONTEXT, NOW)).toEqual({ ok: false, state, reason: 'not-found' });
  });

  test('a rehearsal that appeared in the calendar meanwhile refuses the confirmation and frees the hold', () => {
    const state = held([request('a'), request('b', AFTERNOON)]);
    const context: BookingContext = { ...CONTEXT, calendar: [busy('calendar', DAY, '12:00', '13:00')] };
    const result = confirm(state, 'a', context, NOW + MINUTE);
    expect(result).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(result.state.holds.map((each) => each.id)).toEqual(['b']);
    // The day is broken now, but 14:00-18:00 is still one of its free windows: that hold stands.
    expect(confirm(result.state, 'b', context, NOW + MINUTE)).toMatchObject({ ok: true });
    const longer: BookingContext = { ...CONTEXT, calendar: [busy('calendar', DAY, '12:00', '13:45')] };
    expect(confirm(result.state, 'b', longer, NOW + MINUTE)).toEqual({ ok: false, state: EMPTY_STATE, reason: 'unavailable' });
  });

  test('a rehearsal elsewhere in the calendar does not disturb it', () => {
    const context: BookingContext = { ...CONTEXT, calendar: [busy('calendar', DAY, '19:00', '22:00'), busy('calendar', '2026-06-02', '10:00', '12:00')] };
    expect(confirm(held([request('a', WHOLE_DAY)]), 'a', context, NOW)).toMatchObject({ ok: true });
  });

  test('the technician picked is checked again', () => {
    const state = held([request('a', MORNING, 'anna')]);
    const away: BookingContext = { ...CONTEXT, technicians: [{ id: 'anna', busy: [between(DAY, '12:00', '15:00')] }, BEN] };
    expect(confirm(state, 'a', away, NOW)).toEqual({ ok: false, state: EMPTY_STATE, reason: 'technician-unavailable' });
    expect(confirm(state, 'a', { ...CONTEXT, technicians: [BEN] }, NOW)).toMatchObject({ ok: false, reason: 'unknown-technician' });
  });

  test('the lead time is not asked again: a hold made at the last moment can still be paid', () => {
    const lastMoment = at('2026-05-31', '09:00');
    const result = hold(EMPTY_STATE, request('a'), CONTEXT, lastMoment);
    expect(result.ok).toBe(true);
    expect(confirm(result.state, 'a', CONTEXT, lastMoment + 5 * MINUTE)).toMatchObject({ ok: true });
  });

  test('two blocks of a day confirm one after the other, an hour apart', () => {
    const state = held([request('a'), request('b', AFTERNOON)]);
    const first = confirm(state, 'a', CONTEXT, NOW + MINUTE);
    const second = confirm(first.state, 'b', CONTEXT, NOW + MINUTE);
    expect(second.state.sessions.map((session) => session.id)).toEqual(['a', 'b']);
    expect(second.state.holds).toEqual([]);
  });
});

describe('anyone', () => {
  const technicianOf = (state: BookingState, id: string): string | undefined => state.sessions.find((session) => session.id === id)?.technicianId;

  test('with one technician busy, the other is assigned', () => {
    const context: BookingContext = { ...CONTEXT, technicians: [{ id: 'anna', busy: [between(DAY, '08:00', '10:00')] }, BEN] };
    expect(technicianOf(booked([request('a')], context), 'a')).toBe('ben');
  });

  test('a technician who became busy after the hold is passed over; with none left the hold is freed', () => {
    const state = held([request('a')]);
    const annaAway: Technician = { id: 'anna', busy: [between(DAY, '08:00', '10:00')] };
    const benAway: Technician = { id: 'ben', busy: [between(DAY, '12:59', '13:30')] };
    const one = confirm(state, 'a', { ...CONTEXT, technicians: [annaAway, BEN] }, NOW);
    expect(one.ok && one.session.technicianId).toBe('ben');
    expect(confirm(state, 'a', { ...CONTEXT, technicians: [annaAway, benAway] }, NOW)).toEqual({ ok: false, state: EMPTY_STATE, reason: 'technician-unavailable' });
  });

  test('among equals the first listed is assigned', () => {
    expect(technicianOf(booked([request('a')]), 'a')).toBe('anna');
    expect(technicianOf(booked([request('a')], { ...CONTEXT, technicians: [BEN, ANNA] }), 'a')).toBe('ben');
  });

  test('the one with less session time ahead is assigned', () => {
    const state = booked([request('a'), request('b', AFTERNOON), request('c', between('2026-06-02', '09:00', '13:00'))]);
    expect(['a', 'b', 'c'].map((id) => technicianOf(state, id))).toEqual(['anna', 'ben', 'anna']);
    // Anna has 8 hours ahead, Ben 4: a whole day goes to Ben, who then has 13, so the next block goes to Anna.
    const more = booked([
      request('a'),
      request('b', AFTERNOON),
      request('c', between('2026-06-02', '09:00', '13:00')),
      request('d', between('2026-06-03', '09:00', '18:00')),
      request('e', between('2026-06-04', '09:00', '13:00')),
    ]);
    expect(['d', 'e'].map((id) => technicianOf(more, id))).toEqual(['ben', 'anna']);
  });

  test('sessions already over do not count as load', () => {
    const state = booked([request('a', MORNING, 'anna')]);
    const [slot] = availability('2026-06-02', DEFAULT_SETTINGS, busyOf(state, CONTEXT, NOW), CONTEXT.technicians, NOW)[0]?.slots ?? [];
    if (!slot) throw new Error('no slot');
    expect(assignTechnician(slot, state, CONTEXT, NOW)).toBe('ben');
    expect(assignTechnician(slot, state, CONTEXT, MORNING.end)).toBe('anna');
    expect(assignTechnician({ ...slot, technicians: [] }, state, CONTEXT, NOW)).toBeUndefined();
  });

  test('a picked technician is kept, however loaded', () => {
    const state = booked([request('a', MORNING, 'anna'), request('b', AFTERNOON, 'anna')]);
    expect(state.sessions.map((session) => session.technicianId)).toEqual(['anna', 'anna']);
  });
});

describe('what takes the studio', () => {
  test('the calendar, the sessions and the running holds, one hold left out on request', () => {
    const context: BookingContext = { ...CONTEXT, calendar: [busy('calendar', DAY, '19:00', '22:00')] };
    const state = held([request('b', AFTERNOON)], context, booked([request('a')], context));
    expect(busyOf(state, context, NOW)).toEqual([busy('calendar', DAY, '19:00', '22:00'), { ...MORNING, kind: 'session' }, { ...AFTERNOON, kind: 'hold' }]);
    expect(busyOf(state, context, NOW, 'b')).toHaveLength(2);
    expect(busyOf(state, context, NOW + HELD_FOR)).toHaveLength(2);
  });

  test('the state is plain data', () => {
    const state = held([request('b', AFTERNOON)], CONTEXT, booked([request('a')]));
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe('late acceptance', () => {
  const LATE = NOW + HELD_FOR + MINUTE;

  test('while the hold runs it is a confirmation like any other, and repeats safely', () => {
    const state = held([request('a')]);
    const first = confirmLate(state, request('a'), CONTEXT, NOW + MINUTE);
    expect(first).toMatchObject({ ok: true, late: false, session: { id: 'a', technicianId: 'anna', confirmedAt: NOW + MINUTE } });
    expect(first.state.holds).toEqual([]);
    const again = confirmLate(first.state, request('a'), CONTEXT, LATE);
    expect(again).toMatchObject({ ok: true, late: false, session: { confirmedAt: NOW + MINUTE } });
    expect(again.state).toBe(first.state);
  });

  test('an expired hold is confirmed when the slot is still free, whether or not the hold was cleared', () => {
    const state = held([request('a', MORNING, 'ben')]);
    expect(confirm(state, 'a', CONTEXT, LATE)).toMatchObject({ ok: false, reason: 'expired' });
    for (const from of [state, expire(state, LATE), EMPTY_STATE]) {
      const late = confirmLate(from, request('a', MORNING, 'ben'), CONTEXT, LATE);
      expect(late).toMatchObject({ ok: true, late: true, session: { id: 'a', ...MORNING, technicianId: 'ben', confirmedAt: LATE } });
      expect(late.state).toEqual({ holds: [], sessions: [{ id: 'a', ...MORNING, technicianId: 'ben', confirmedAt: LATE }] });
    }
  });

  test('the lead time and the horizon are not applied again; a slot that has begun is not given', () => {
    const inside = at(DAY, '09:00') - 60 * MINUTE;
    expect(hold(EMPTY_STATE, request('b'), CONTEXT, inside)).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(confirmLate(EMPTY_STATE, request('a'), CONTEXT, inside)).toMatchObject({ ok: true, late: true });
    const far = between('2026-09-01', '09:00', '13:00');
    expect(confirmLate(EMPTY_STATE, request('a', far), CONTEXT, NOW)).toMatchObject({ ok: true, late: true });
    expect(confirmLate(EMPTY_STATE, request('a'), CONTEXT, at(DAY, '09:00') + 1)).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  test('everything else is checked as it is now: holds, sessions, the calendar, the technician', () => {
    const taken = held([request('b')], CONTEXT, EMPTY_STATE);
    expect(confirmLate(taken, request('a'), CONTEXT, NOW + 5000)).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(confirmLate(taken, request('a'), CONTEXT, NOW + 5000).state.holds.map((h) => h.id)).toEqual(['b']);
    expect(confirmLate(booked([request('b', WHOLE_DAY)]), request('a'), CONTEXT, LATE)).toMatchObject({ ok: false, reason: 'unavailable' });

    const rehearsal: BookingContext = { ...CONTEXT, calendar: [busy('calendar', DAY, '10:00', '11:00')] };
    expect(confirmLate(EMPTY_STATE, request('a'), rehearsal, LATE)).toMatchObject({ ok: false, reason: 'unavailable' });

    const away: BookingContext = { ...CONTEXT, technicians: [{ ...ANNA, busy: [MORNING] }, BEN] };
    expect(confirmLate(EMPTY_STATE, request('a', MORNING, 'anna'), away, LATE)).toMatchObject({ ok: false, reason: 'technician-unavailable' });
    expect(confirmLate(EMPTY_STATE, request('a', MORNING, 'carl'), away, LATE)).toMatchObject({ ok: false, reason: 'unknown-technician' });
    expect(confirmLate(EMPTY_STATE, request('a'), away, LATE)).toMatchObject({ ok: true, session: { technicianId: 'ben' } });
    expect(confirmLate(EMPTY_STATE, request('a', between(DAY, '10:00', '12:00')), CONTEXT, LATE)).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  test('an id that stands for another slot is refused, and that slot is left alone', () => {
    const state = held([request('a')]);
    const other = confirmLate(state, request('a', AFTERNOON), CONTEXT, NOW + MINUTE);
    expect(other).toMatchObject({ ok: false, reason: 'duplicate-id' });
    expect(other.state.holds).toHaveLength(1);
    const session = booked([request('a')]);
    expect(confirmLate(session, request('a', AFTERNOON), CONTEXT, LATE)).toMatchObject({ ok: false, reason: 'duplicate-id' });
  });
});
