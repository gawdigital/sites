// Google Calendar through the Calendar API v3, for technicians who keep their calendar there: free/busy for
// many calendars at once, events in calendars we own, and push through watch channels (which expire and are
// renewed by creating a new one). Authorization is somebody else's job: an injected function returns an access
// token.
//
// Confirmed from the official documentation on 2026-11-24:
//  - `POST https://www.googleapis.com/calendar/v3/freeBusy` with `timeMin`, `timeMax` (RFC 3339), `timeZone`,
//    `items[].id`; `calendarExpansionMax` has a maximum of 50, which is the number of calendars one query answers
//    for; the answer is `calendars.<id>.busy[].{start,end}` (start inclusive, end exclusive) and, where a calendar
//    could not be computed, `calendars.<id>.errors[].{domain,reason}` (`notFound`, `tooManyCalendarsRequested`,
//    `groupTooBig`, `internalError`, and others).
//    https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query (2026-11-24)
//  - `POST …/calendars/{calendarId}/events` (insert), `PATCH …/calendars/{calendarId}/events/{eventId}` (patch:
//    given fields replace, others stay; three quota units), `DELETE …/calendars/{calendarId}/events/{eventId}`
//    (empty answer). An event `id` given on insert uses base32hex characters only (`a`-`v`, `0`-`9`), 5-1024 of
//    them, unique per calendar.
//    https://developers.google.com/workspace/calendar/api/v3/reference/events/insert (2026-11-24)
//    https://developers.google.com/workspace/calendar/api/v3/reference/events/patch (2026-11-24)
//    https://developers.google.com/workspace/calendar/api/v3/reference/events/delete (2026-11-24)
//  - `POST …/calendars/{calendarId}/events/watch` with `id` (unique, at most 64 characters), `type: "web_hook"`,
//    `address` (https, a valid certificate), optional `token` (at most 256 characters) and `params.ttl` (seconds,
//    as a string; the default is 604800); the answer carries `resourceId` and `expiration` (Unix milliseconds).
//    There is no renewal call: before a channel expires, a new one is created with a new id, and the two may
//    overlap. `POST https://www.googleapis.com/calendar/v3/channels/stop` with `id` and `resourceId` stops one.
//    Notifications have no body, only headers: `X-Goog-Channel-ID`, `X-Goog-Message-Number`, `X-Goog-Resource-ID`,
//    `X-Goog-Resource-State` (`sync` once after creation, `exists` for a change, `not_exists`),
//    `X-Goog-Resource-URI`, and optionally `X-Goog-Channel-Expiration` and `X-Goog-Channel-Token`. The receiver
//    answers 200, 201, 202, 204 or 102.
//    https://developers.google.com/workspace/calendar/api/guides/push (2026-11-24)
//    https://developers.google.com/workspace/calendar/api/v3/reference/events/watch (2026-11-24)
//
// UNVERIFIED (not stated on those pages; handled as commonly observed):
//  - Inserting an event whose `id` already exists answers 409, also when that event was deleted (a deleted event
//    keeps its id, with `status: "cancelled"`). `write` therefore falls back to a PATCH, which also sets
//    `status: "confirmed"` to bring a deleted event back.
//  - Deleting an event that is already deleted answers 410, a missing one 404; both count as "was not there".
//  - The exact format of `X-Goog-Channel-Expiration` ("human-readable"); it is read with `Date.parse`.
//  - The longest lifetime Google grants a channel, and the longest window a free/busy query accepts.
//
// Free/busy tells when, never what: its intervals carry no event id and no all-day flag. That is all a
// technician's personal calendar is read for. It also means our own events cannot be told apart in a Google
// calendar read this way; the studio's shared calendar, where that matters, is the iCloud one.

import { assertOurs, type BusyInterval, type BusyReading, byStart, CalendarError, type CalendarProvider, type CalendarRef, type StudioEvent, type WriteResult } from './types.ts';
import { googleEventId } from './uid.ts';

export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
/** How many calendars one `freeBusy.query` answers for (the maximum of `calendarExpansionMax`). */
export const FREEBUSY_MAX_CALENDARS = 50;
export const CHANNEL_ID_MAX = 64;
export const CHANNEL_TOKEN_MAX = 256;

/** A request to the API, ready to send once the access token is added. */
export interface ApiRequest {
  method: 'POST' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
}

const calendarPath = (calendarId: string): string => `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}`;
const iso = (instant: number): string => new Date(instant).toISOString();

// Free/busy

/** The `freeBusy.query` requests for any number of calendars: one for every 50. */
export function freeBusyRequests(calendarIds: readonly string[], from: number, to: number): ApiRequest[] {
  const ids = [...new Set(calendarIds)];
  const requests: ApiRequest[] = [];
  for (let i = 0; i < ids.length; i += FREEBUSY_MAX_CALENDARS) {
    const items = ids.slice(i, i + FREEBUSY_MAX_CALENDARS).map((id) => ({ id }));
    requests.push({
      method: 'POST',
      url: `${GOOGLE_CALENDAR_API}/freeBusy`,
      body: { timeMin: iso(from), timeMax: iso(to), timeZone: 'UTC', calendarExpansionMax: FREEBUSY_MAX_CALENDARS, items },
    });
  }
  return requests;
}

interface FreeBusyAnswer {
  calendars?: Record<string, { busy?: { start?: string; end?: string }[]; errors?: { domain?: string; reason?: string }[] }>;
}

/**
 * A `freeBusy.query` answer as one reading per asked calendar. A calendar the answer leaves out, or reports
 * errors for, reads as `unavailable`, never as free.
 */
export function readFreeBusy(answer: unknown, calendarIds: readonly string[]): Map<string, BusyReading> {
  const calendars = (answer as FreeBusyAnswer | null)?.calendars ?? {};
  const readings = new Map<string, BusyReading>();
  for (const id of calendarIds) {
    const calendar = Object.hasOwn(calendars, id) ? calendars[id] : undefined;
    const reading: BusyReading = { intervals: [], problems: [] };
    if (!calendar) reading.problems.push({ kind: 'unavailable', reason: 'missing from the answer' });
    for (const error of calendar?.errors ?? []) reading.problems.push({ kind: 'unavailable', reason: error.reason ?? 'unknown' });
    for (const busy of calendar?.busy ?? []) {
      const interval: BusyInterval = { start: Date.parse(busy.start ?? ''), end: Date.parse(busy.end ?? ''), allDay: false };
      if (Number.isNaN(interval.start) || Number.isNaN(interval.end)) reading.problems.push({ kind: 'unavailable', reason: 'an unreadable busy time' });
      else if (interval.end > interval.start) reading.intervals.push(interval);
    }
    reading.intervals.sort(byStart);
    readings.set(id, reading);
  }
  return readings;
}

// Events

/** The body of an event we own: opaque and confirmed, in UTC. */
export function eventBody(event: StudioEvent): Record<string, unknown> {
  return {
    summary: event.summary,
    description: event.description ?? '',
    location: event.location ?? '',
    start: { dateTime: iso(event.start), timeZone: 'UTC' },
    end: { dateTime: iso(event.end), timeZone: 'UTC' },
    status: 'confirmed',
    transparency: 'opaque',
  };
}

export function insertRequest(calendarId: string, event: StudioEvent): ApiRequest {
  return { method: 'POST', url: `${calendarPath(calendarId)}/events`, body: { id: googleEventId(event.bookingId), ...eventBody(event) } };
}

export function patchRequest(calendarId: string, event: StudioEvent): ApiRequest {
  return { method: 'PATCH', url: `${calendarPath(calendarId)}/events/${googleEventId(event.bookingId)}`, body: eventBody(event) };
}

export function deleteRequest(calendarId: string, bookingId: string): ApiRequest {
  return { method: 'DELETE', url: `${calendarPath(calendarId)}/events/${googleEventId(bookingId)}` };
}

// Watch channels

export interface WatchOptions {
  /** A new, unique id for the channel (a UUID); at most 64 characters. */
  channelId: string;
  /** Our https endpoint that receives the notifications. */
  address: string;
  /** Echoed in `X-Goog-Channel-Token`: a random value to recognise our own channels by. Not a secret store. */
  token?: string;
  /** The lifetime asked for, in seconds; Google may grant less. */
  ttlSeconds?: number;
}

/** A channel as Google confirmed it: what must be kept to recognise its notifications, renew it and stop it. */
export interface WatchChannel {
  calendarId: string;
  channelId: string;
  resourceId: string;
  /** When it stops delivering, if Google said. */
  expiration?: number;
  token?: string;
}

/** The request that opens a channel on a calendar's events. */
export function watchRequest(calendarId: string, options: WatchOptions): ApiRequest {
  if (options.channelId === '' || options.channelId.length > CHANNEL_ID_MAX) throw new RangeError('A channel id is 1-64 characters.');
  if (options.token !== undefined && options.token.length > CHANNEL_TOKEN_MAX) throw new RangeError('A channel token is at most 256 characters.');
  if (!options.address.startsWith('https://')) throw new RangeError('A channel address is an https URL.');
  return {
    method: 'POST',
    url: `${calendarPath(calendarId)}/events/watch`,
    body: {
      id: options.channelId,
      type: 'web_hook',
      address: options.address,
      ...(options.token === undefined ? {} : { token: options.token }),
      ...(options.ttlSeconds === undefined ? {} : { params: { ttl: String(Math.floor(options.ttlSeconds)) } }),
    },
  };
}

/** The request that stops a channel. */
export function stopRequest(channel: Pick<WatchChannel, 'channelId' | 'resourceId'>): ApiRequest {
  return { method: 'POST', url: `${GOOGLE_CALENDAR_API}/channels/stop`, body: { id: channel.channelId, resourceId: channel.resourceId } };
}

/** The channel a `watch` answer describes. */
export function readChannel(calendarId: string, answer: unknown): WatchChannel {
  const a = (answer ?? {}) as { id?: unknown; resourceId?: unknown; expiration?: unknown; token?: unknown };
  if (typeof a.id !== 'string' || typeof a.resourceId !== 'string') throw new CalendarError('protocol', 'The watch answer names no channel.');
  // A `long` may arrive as a number or as a string of digits; both are read.
  const expiration = Number(a.expiration);
  return {
    calendarId,
    channelId: a.id,
    resourceId: a.resourceId,
    ...(a.expiration !== undefined && Number.isFinite(expiration) && expiration > 0 ? { expiration } : {}),
    ...(typeof a.token === 'string' ? { token: a.token } : {}),
  };
}

/**
 * Whether a channel should be replaced now: it ends within `lead` milliseconds, or never said when it ends.
 * Renewal is a new channel (new id) on the same calendar, then stopping the old one.
 */
export function renewalDue(channel: Pick<WatchChannel, 'expiration'>, now: number, lead: number): boolean {
  return channel.expiration === undefined || channel.expiration - now <= lead;
}

/** What a push notification says. It never says what changed: the calendar is then read again. */
export interface PushNotification {
  channelId: string;
  resourceId: string;
  /** `sync`: the channel was just created, nothing changed. `exists`: something did. */
  state: 'sync' | 'exists' | 'not_exists';
  messageNumber: number;
  resourceUri?: string;
  /** To be compared with the token the channel was created with, before the notification is believed. */
  token?: string;
  expiration?: number;
}

/** Reads a notification from the request's headers; `undefined` when it is not one. */
export function parsePushHeaders(headers: Headers): PushNotification | undefined {
  const channelId = headers.get('X-Goog-Channel-ID');
  const resourceId = headers.get('X-Goog-Resource-ID');
  const state = headers.get('X-Goog-Resource-State');
  const number = headers.get('X-Goog-Message-Number');
  const messageNumber = Number(number);
  if (!channelId || !resourceId || !number || !Number.isFinite(messageNumber)) return undefined;
  if (state !== 'sync' && state !== 'exists' && state !== 'not_exists') return undefined;
  const resourceUri = headers.get('X-Goog-Resource-URI');
  const token = headers.get('X-Goog-Channel-Token');
  const expiration = Date.parse(headers.get('X-Goog-Channel-Expiration') ?? '');
  return {
    channelId,
    resourceId,
    state,
    messageNumber,
    ...(resourceUri ? { resourceUri } : {}),
    ...(token === null ? {} : { token }),
    ...(Number.isNaN(expiration) ? {} : { expiration }),
  };
}

/** Whether a notification belongs to the channel we keep: the same ids, and the token it was created with. */
export function isFromChannel(notification: PushNotification, channel: WatchChannel): boolean {
  return notification.channelId === channel.channelId && notification.resourceId === channel.resourceId && notification.token === channel.token;
}

// The provider

/**
 * The provider over the Calendar API. A `CalendarRef.id` is the Google calendar id. Events are written only
 * into calendars we own (`ours`); everything else is read through free/busy.
 */
export class GoogleCalendar implements CalendarProvider {
  readonly name = 'google';
  readonly capabilities = { canWrite: true, hasPush: true } as const;
  readonly #fetch: typeof fetch;
  readonly #accessToken: () => Promise<string>;

  constructor(options: { fetch: typeof fetch; accessToken: () => Promise<string> }) {
    this.#fetch = options.fetch;
    this.#accessToken = options.accessToken;
  }

  async #send(request: ApiRequest): Promise<Response> {
    const response = await this.#fetch(request.url, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${await this.#accessToken()}`,
        ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    });
    if (response.status === 401) throw new CalendarError('auth', 'Google refused the access token.', 401);
    return response;
  }

  async #json(request: ApiRequest): Promise<unknown> {
    const response = await this.#send(request);
    if (!response.ok) throw failure(response.status, request);
    return response.json();
  }

  /** The busy time of many calendars in as few queries as the limit allows. */
  async busyMany(calendarIds: readonly string[], from: number, to: number): Promise<Map<string, BusyReading>> {
    const readings = new Map<string, BusyReading>();
    for (const request of freeBusyRequests(calendarIds, from, to)) {
      const asked = (request.body as { items: { id: string }[] }).items.map((item) => item.id);
      for (const [id, reading] of readFreeBusy(await this.#json(request), asked)) readings.set(id, reading);
    }
    return readings;
  }

  async busy(calendar: CalendarRef, from: number, to: number): Promise<BusyReading> {
    const readings = await this.busyMany([calendar.id], from, to);
    return readings.get(calendar.id) ?? { intervals: [], problems: [{ kind: 'unavailable', reason: 'missing from the answer' }] };
  }

  async write(calendar: CalendarRef, event: StudioEvent): Promise<WriteResult> {
    assertOurs(calendar);
    const request = insertRequest(calendar.id, event);
    const response = await this.#send(request);
    // The id is taken: the event is there already, or was and is deleted. Either way, bring it to this content.
    if (response.status === 409) return this.update(calendar, event);
    if (!response.ok) throw failure(response.status, request);
    return result(event, true, await response.json());
  }

  /** `etag` is not used: a PATCH replaces the fields we own whatever the version. */
  async update(calendar: CalendarRef, event: StudioEvent): Promise<WriteResult> {
    assertOurs(calendar);
    return result(event, false, await this.#json(patchRequest(calendar.id, event)));
  }

  async remove(calendar: CalendarRef, bookingId: string): Promise<{ removed: boolean }> {
    assertOurs(calendar);
    const request = deleteRequest(calendar.id, bookingId);
    const response = await this.#send(request);
    if (response.status === 404 || response.status === 410) return { removed: false };
    if (!response.ok) throw failure(response.status, request);
    return { removed: true };
  }

  /** Opens a watch channel on a calendar's events. To renew, call it again with a new `channelId`. */
  async watch(calendarId: string, options: WatchOptions): Promise<WatchChannel> {
    const channel = readChannel(calendarId, await this.#json(watchRequest(calendarId, options)));
    return { ...channel, ...(options.token === undefined ? {} : { token: channel.token ?? options.token }) };
  }

  /** Stops a channel; one that is already gone (404) counts as stopped. */
  async stop(channel: Pick<WatchChannel, 'channelId' | 'resourceId'>): Promise<void> {
    const request = stopRequest(channel);
    const response = await this.#send(request);
    if (!response.ok && response.status !== 404) throw failure(response.status, request);
  }
}

function result(event: StudioEvent, created: boolean, answer: unknown): WriteResult {
  const etag = (answer as { etag?: unknown } | null)?.etag;
  return { eventId: googleEventId(event.bookingId), created, ...(typeof etag === 'string' ? { etag } : {}) };
}

function failure(status: number, request: ApiRequest): CalendarError {
  const what = `${request.method} ${request.url}`;
  if (status === 404 || status === 410) return new CalendarError('not-found', `${what}: not found`, status);
  return new CalendarError('http', `${what}: HTTP ${status}`, status);
}
