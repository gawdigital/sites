import { describe, expect, test } from 'bun:test';

import {
  deleteRequest,
  FREEBUSY_MAX_CALENDARS,
  freeBusyRequests,
  GoogleCalendar,
  insertRequest,
  isFromChannel,
  parsePushHeaders,
  patchRequest,
  readChannel,
  readFreeBusy,
  renewalDue,
  stopRequest,
  watchRequest,
} from './google.ts';
import { scripted } from './testing.ts';
import { CalendarError, type CalendarRef, type StudioEvent } from './types.ts';
import { googleEventId } from './uid.ts';
import { DAY, HOUR } from './zone.ts';

const utc = (y: number, mo: number, d: number, h = 0): number => Date.UTC(y, mo - 1, d, h);
const FROM = utc(2026, 11, 23, 23);
const TO = utc(2026, 11, 30, 23);
const API = 'https://www.googleapis.com/calendar/v3';
const accessToken = async (): Promise<string> => 'ya29.test-token';
const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `calendar-${i}@group.calendar.example.com`);

async function errorOf(action: Promise<unknown>): Promise<CalendarError | undefined> {
  try {
    await action;
  } catch (error) {
    if (error instanceof CalendarError) return error;
    throw error;
  }
  return undefined;
}

describe('free/busy', () => {
  test('one query for up to 50 calendars', () => {
    const requests = freeBusyRequests(['name@example.com', 'other@example.com'], FROM, TO);
    expect(requests).toEqual([
      {
        method: 'POST',
        url: `${API}/freeBusy`,
        body: {
          timeMin: '2026-11-23T23:00:00.000Z',
          timeMax: '2026-11-30T23:00:00.000Z',
          timeZone: 'UTC',
          calendarExpansionMax: 50,
          items: [{ id: 'name@example.com' }, { id: 'other@example.com' }],
        },
      },
    ]);
  });

  test('more calendars are asked for in batches of 50, each once', () => {
    expect(FREEBUSY_MAX_CALENDARS).toBe(50);
    const size = (n: number): number[] => freeBusyRequests(ids(n), FROM, TO).map((r) => (r.body as { items: unknown[] }).items.length);
    expect(size(0)).toEqual([]);
    expect(size(50)).toEqual([50]);
    expect(size(51)).toEqual([50, 1]);
    expect(size(120)).toEqual([50, 50, 20]);
    expect(freeBusyRequests(['a', 'b', 'a'], FROM, TO)[0]?.body).toMatchObject({ items: [{ id: 'a' }, { id: 'b' }] });
  });

  test('the answer maps to intervals per calendar; an error or a gap is never "free"', () => {
    const answer = {
      kind: 'calendar#freeBusy',
      timeMin: '2026-11-23T23:00:00.000Z',
      timeMax: '2026-11-30T23:00:00.000Z',
      calendars: {
        'name@example.com': {
          busy: [
            { start: '2026-11-25T13:00:00Z', end: '2026-11-25T14:30:00Z' },
            { start: '2026-11-24T10:00:00+01:00', end: '2026-11-24T12:00:00+01:00' },
          ],
        },
        'free@example.com': { busy: [] },
        'private@example.com': { errors: [{ domain: 'global', reason: 'notFound' }], busy: [] },
      },
    };
    const readings = readFreeBusy(answer, ['name@example.com', 'free@example.com', 'private@example.com', 'left-out@example.com']);
    expect(readings.get('name@example.com')).toEqual({
      intervals: [
        { start: utc(2026, 11, 24, 9), end: utc(2026, 11, 24, 11), allDay: false },
        { start: utc(2026, 11, 25, 13), end: utc(2026, 11, 25, 14) + HOUR / 2, allDay: false },
      ],
      problems: [],
    });
    expect(readings.get('free@example.com')).toEqual({ intervals: [], problems: [] });
    expect(readings.get('private@example.com')).toEqual({ intervals: [], problems: [{ kind: 'unavailable', reason: 'notFound' }] });
    expect(readings.get('left-out@example.com')).toEqual({ intervals: [], problems: [{ kind: 'unavailable', reason: 'missing from the answer' }] });
  });

  test('an unreadable answer leaves every calendar unavailable', () => {
    expect(readFreeBusy(null, ['a']).get('a')?.problems).toHaveLength(1);
    expect(readFreeBusy({ calendars: { a: { busy: [{ start: 'soon', end: 'later' }] } } }, ['a']).get('a')).toEqual({
      intervals: [],
      problems: [{ kind: 'unavailable', reason: 'an unreadable busy time' }],
    });
    // A calendar id cannot reach into the object's prototype.
    expect(readFreeBusy({ calendars: {} }, ['constructor']).get('constructor')?.problems).toHaveLength(1);
  });

  test('the provider sends the batches with the access token and joins the answers', async () => {
    const all = ids(60);
    const calendars = (list: string[]) => ({ calendars: Object.fromEntries(list.map((id) => [id, { busy: [{ start: '2026-11-24T09:00:00Z', end: '2026-11-24T10:00:00Z' }] }])) });
    const { fetch, requests } = scripted([{ json: calendars(all.slice(0, 50)) }, { json: calendars(all.slice(50)) }]);
    const readings = await new GoogleCalendar({ fetch, accessToken }).busyMany(all, FROM, TO);

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect([request.method, request.url]).toEqual(['POST', `${API}/freeBusy`]);
      expect(request.headers.authorization).toBe('Bearer ya29.test-token');
      expect(request.headers['content-type']).toBe('application/json');
    }
    expect(JSON.parse(requests[1]?.body ?? '{}').items).toHaveLength(10);
    expect(readings.size).toBe(60);
    expect([...readings.values()].every((r) => r.intervals.length === 1 && r.problems.length === 0)).toBe(true);
  });

  test('busy is the same query for one calendar', async () => {
    const { fetch, requests } = scripted([{ json: { calendars: { 'name@example.com': { busy: [{ start: '2026-11-24T09:00:00Z', end: '2026-11-24T10:00:00Z' }] } } } }]);
    const reading = await new GoogleCalendar({ fetch, accessToken }).busy({ id: 'name@example.com', ours: false }, FROM, TO);
    expect(reading).toEqual({ intervals: [{ start: utc(2026, 11, 24, 9), end: utc(2026, 11, 24, 10), allDay: false }], problems: [] });
    expect(JSON.parse(requests[0]?.body ?? '{}').items).toEqual([{ id: 'name@example.com' }]);
  });

  test('a refused token is an auth error, anything else an HTTP one', async () => {
    const provider = (status: number): GoogleCalendar => new GoogleCalendar({ fetch: scripted([{ status, json: { error: {} } }]).fetch, accessToken });
    expect((await errorOf(provider(401).busyMany(['a'], FROM, TO)))?.kind).toBe('auth');
    const limited = await errorOf(provider(429).busyMany(['a'], FROM, TO));
    expect([limited?.kind, limited?.status]).toEqual(['http', 429]);
  });
});

describe('events in calendars we own', () => {
  const calendar: CalendarRef = { id: 'studio@group.calendar.example.com', ours: true };
  const personal: CalendarRef = { id: 'name@example.com', ours: false };
  const session: StudioEvent = { bookingId: 'b1', start: utc(2026, 11, 24, 9), end: utc(2026, 11, 24, 13), summary: 'Recording', location: 'Studio A' };
  const eventId = googleEventId('b1');
  const EVENTS = `${API}/calendars/studio%40group.calendar.example.com/events`;
  const body = {
    summary: 'Recording',
    description: '',
    location: 'Studio A',
    start: { dateTime: '2026-11-24T09:00:00.000Z', timeZone: 'UTC' },
    end: { dateTime: '2026-11-24T13:00:00.000Z', timeZone: 'UTC' },
    status: 'confirmed',
    transparency: 'opaque',
  };

  test('the requests', () => {
    expect(insertRequest(calendar.id, session)).toEqual({ method: 'POST', url: EVENTS, body: { id: eventId, ...body } });
    expect(patchRequest(calendar.id, session)).toEqual({ method: 'PATCH', url: `${EVENTS}/${eventId}`, body });
    expect(deleteRequest(calendar.id, 'b1')).toEqual({ method: 'DELETE', url: `${EVENTS}/${eventId}` });
  });

  test('write inserts under the booking’s id', async () => {
    const { fetch, requests } = scripted([{ json: { id: eventId, etag: '"3181161784712000"' } }]);
    const result = await new GoogleCalendar({ fetch, accessToken }).write(calendar, session);
    expect(result).toEqual({ eventId, created: true, etag: '"3181161784712000"' });
    expect([requests[0]?.method, requests[0]?.url]).toEqual(['POST', EVENTS]);
    expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({ id: eventId, ...body });
  });

  test('an id that is taken means the event exists (or was deleted): it is patched back', async () => {
    const { fetch, requests } = scripted([{ status: 409, json: { error: { code: 409 } } }, { json: { id: eventId } }]);
    const result = await new GoogleCalendar({ fetch, accessToken }).write(calendar, session);
    expect(result).toEqual({ eventId, created: false });
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([`POST ${EVENTS}`, `PATCH ${EVENTS}/${eventId}`]);
    expect(JSON.parse(requests[1]?.body ?? '{}').status).toBe('confirmed');
  });

  test('update patches, and a missing event is not found', async () => {
    const { fetch, requests } = scripted([{ json: { etag: '"2"' } }, { status: 404, json: {} }]);
    const provider = new GoogleCalendar({ fetch, accessToken });
    expect(await provider.update(calendar, session)).toEqual({ eventId, created: false, etag: '"2"' });
    expect((await errorOf(provider.update(calendar, session)))?.kind).toBe('not-found');
    expect([requests[0]?.method, requests[0]?.url]).toEqual(['PATCH', `${EVENTS}/${eventId}`]);
  });

  test('remove deletes without a body; gone already is fine', async () => {
    const { fetch, requests } = scripted([{ status: 204 }, { status: 410, json: {} }, { status: 404, json: {} }]);
    const provider = new GoogleCalendar({ fetch, accessToken });
    expect(await provider.remove(calendar, 'b1')).toEqual({ removed: true });
    expect(await provider.remove(calendar, 'b1')).toEqual({ removed: false });
    expect(await provider.remove(calendar, 'b1')).toEqual({ removed: false });
    expect(requests[0]).toMatchObject({ method: 'DELETE', url: `${EVENTS}/${eventId}`, body: undefined });
    expect(requests[0]?.headers['content-type']).toBeUndefined();
  });

  test('a personal calendar is never written: no request leaves', async () => {
    const { fetch, requests } = scripted([]);
    const provider = new GoogleCalendar({ fetch, accessToken });
    expect((await errorOf(provider.write(personal, session)))?.kind).toBe('read-only');
    expect((await errorOf(provider.update(personal, session)))?.kind).toBe('read-only');
    expect((await errorOf(provider.remove(personal, 'b1')))?.kind).toBe('read-only');
    expect(requests).toEqual([]);
    expect(provider.capabilities).toEqual({ canWrite: true, hasPush: true });
  });
});

describe('watch channels', () => {
  const options = { channelId: '01234567-89ab-cdef-0123-456789abcdef', address: 'https://studio.example.com/api/calendar/push', token: 'r4nd0m', ttlSeconds: 604800 };
  const WATCH = `${API}/calendars/name%40example.com/events/watch`;

  test('the request that opens one', () => {
    expect(watchRequest('name@example.com', options)).toEqual({
      method: 'POST',
      url: WATCH,
      body: { id: options.channelId, type: 'web_hook', address: options.address, token: 'r4nd0m', params: { ttl: '604800' } },
    });
    expect(watchRequest('primary', { channelId: 'c1', address: 'https://studio.example.com/push' }).body).toEqual({ id: 'c1', type: 'web_hook', address: 'https://studio.example.com/push' });
  });

  test('what Google would refuse is refused before it is sent', () => {
    expect(() => watchRequest('c', { ...options, channelId: 'x'.repeat(65) })).toThrow(RangeError);
    expect(() => watchRequest('c', { ...options, channelId: '' })).toThrow(RangeError);
    expect(() => watchRequest('c', { ...options, token: 'x'.repeat(257) })).toThrow(RangeError);
    expect(() => watchRequest('c', { ...options, address: 'http://studio.example.com/push' })).toThrow(RangeError);
  });

  test('the request that stops one', () => {
    expect(stopRequest({ channelId: 'c1', resourceId: 'o3hgv1538sdjfh' })).toEqual({ method: 'POST', url: `${API}/channels/stop`, body: { id: 'c1', resourceId: 'o3hgv1538sdjfh' } });
  });

  test('the answer is the channel to keep; the expiration may be a string of digits', () => {
    const answer = { kind: 'api#channel', id: 'c1', resourceId: 'o3hgv1538sdjfh', resourceUri: `${API}/calendars/name@example.com/events`, token: 'r4nd0m', expiration: '1764547200000' };
    expect(readChannel('name@example.com', answer)).toEqual({ calendarId: 'name@example.com', channelId: 'c1', resourceId: 'o3hgv1538sdjfh', expiration: 1764547200000, token: 'r4nd0m' });
    expect(readChannel('c', { id: 'c1', resourceId: 'r', expiration: 1764547200000 }).expiration).toBe(1764547200000);
    expect(readChannel('c', { id: 'c1', resourceId: 'r' })).toEqual({ calendarId: 'c', channelId: 'c1', resourceId: 'r' });
    expect(() => readChannel('c', { id: 'c1' })).toThrow(CalendarError);
    expect(() => readChannel('c', null)).toThrow(CalendarError);
  });

  test('a channel is renewed ahead of its end, and at once when it has none on record', () => {
    const now = utc(2026, 11, 24);
    expect(renewalDue({ expiration: now + 3 * DAY }, now, DAY)).toBe(false);
    expect(renewalDue({ expiration: now + DAY }, now, DAY)).toBe(true);
    expect(renewalDue({ expiration: now - HOUR }, now, DAY)).toBe(true);
    expect(renewalDue({}, now, DAY)).toBe(true);
  });

  test('the provider opens, renews (a new id) and stops', async () => {
    const { fetch, requests } = scripted([
      { json: { kind: 'api#channel', id: options.channelId, resourceId: 'res-1', expiration: '1764547200000' } },
      { json: { kind: 'api#channel', id: 'second', resourceId: 'res-1', expiration: '1765152000000' } },
      { status: 204 },
      { status: 404, json: {} },
    ]);
    const provider = new GoogleCalendar({ fetch, accessToken });
    const first = await provider.watch('name@example.com', options);
    expect(first).toEqual({ calendarId: 'name@example.com', channelId: options.channelId, resourceId: 'res-1', expiration: 1764547200000, token: 'r4nd0m' });
    const second = await provider.watch('name@example.com', { ...options, channelId: 'second' });
    expect(second.channelId).toBe('second');
    await provider.stop(first);
    await provider.stop(first);

    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([`POST ${WATCH}`, `POST ${WATCH}`, `POST ${API}/channels/stop`, `POST ${API}/channels/stop`]);
    expect(JSON.parse(requests[2]?.body ?? '{}')).toEqual({ id: options.channelId, resourceId: 'res-1' });
    expect(requests[2]?.headers.authorization).toBe('Bearer ya29.test-token');
  });
});

describe('push notifications', () => {
  const headers = (more: Record<string, string> = {}): Headers =>
    new Headers({
      'X-Goog-Channel-ID': '01234567-89ab-cdef-0123-456789abcdef',
      'X-Goog-Channel-Token': 'r4nd0m',
      'X-Goog-Channel-Expiration': 'Tue, 01 Dec 2026 00:00:00 GMT',
      'X-Goog-Resource-ID': 'res-1',
      'X-Goog-Resource-URI': `${API}/calendars/name@example.com/events?alt=json`,
      'X-Goog-Resource-State': 'exists',
      'X-Goog-Message-Number': '10',
      ...more,
    });
  const channel = { calendarId: 'name@example.com', channelId: '01234567-89ab-cdef-0123-456789abcdef', resourceId: 'res-1', token: 'r4nd0m' };

  test('a change', () => {
    expect(parsePushHeaders(headers())).toEqual({
      channelId: '01234567-89ab-cdef-0123-456789abcdef',
      resourceId: 'res-1',
      state: 'exists',
      messageNumber: 10,
      resourceUri: `${API}/calendars/name@example.com/events?alt=json`,
      token: 'r4nd0m',
      expiration: utc(2026, 12, 1),
    });
  });

  test('the sync message that follows the creation of a channel', () => {
    const sync = parsePushHeaders(headers({ 'X-Goog-Resource-State': 'sync', 'X-Goog-Message-Number': '1' }));
    expect([sync?.state, sync?.messageNumber]).toEqual(['sync', 1]);
  });

  test('header names are case-insensitive; the optional ones may be missing', () => {
    const bare = new Headers({ 'x-goog-channel-id': 'c1', 'x-goog-resource-id': 'r1', 'x-goog-resource-state': 'not_exists', 'x-goog-message-number': '7' });
    expect(parsePushHeaders(bare)).toEqual({ channelId: 'c1', resourceId: 'r1', state: 'not_exists', messageNumber: 7 });
  });

  test('anything else is not a notification', () => {
    expect(parsePushHeaders(new Headers())).toBeUndefined();
    expect(parsePushHeaders(headers({ 'X-Goog-Resource-State': 'exploded' }))).toBeUndefined();
    expect(parsePushHeaders(headers({ 'X-Goog-Message-Number': 'many' }))).toBeUndefined();
    const noChannel = headers();
    noChannel.delete('X-Goog-Channel-ID');
    expect(parsePushHeaders(noChannel)).toBeUndefined();
  });

  test('a notification is believed only for the channel we keep, with its token', () => {
    const notification = parsePushHeaders(headers());
    if (!notification) throw new Error('expected a notification');
    expect(isFromChannel(notification, channel)).toBe(true);
    expect(isFromChannel(notification, { ...channel, token: 'another' })).toBe(false);
    expect(isFromChannel(notification, { ...channel, channelId: 'old-channel' })).toBe(false);
    expect(isFromChannel({ ...notification, token: undefined }, channel)).toBe(false);
  });
});
