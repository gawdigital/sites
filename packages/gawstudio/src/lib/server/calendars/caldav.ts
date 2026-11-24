// A CalDAV client (RFC 4791 over WebDAV, RFC 4918) and the provider built on it, for the studio's iCloud
// calendars. iCloud has no push for third parties that we know of: the calendar is polled (a Cron Trigger, wired
// elsewhere), and `getctag` tells cheaply whether anything changed since the last poll.
//
// iCloud specifics, looked up on 2026-11-24:
//  - An app-specific password is what a third-party app signs in with to reach calendars stored in iCloud; the
//    Apple Account must have two-factor authentication; at most 25 are active at once; changing or resetting the
//    Apple Account password revokes them all (so a sudden 401 means: generate a new one).
//    Source: Apple Support, "Sign in to apps with your Apple Account using app-specific passwords",
//    https://support.apple.com/en-us/102654 (2026-11-24).
//  - The server is https://caldav.icloud.com (port 443), the user name is the Apple Account's e-mail address,
//    discovery is two PROPFINDs (current-user-principal, then calendar-home-set on the principal), and the home
//    set lands on a per-account partition host such as p67-caldav.icloud.com. Apple publishes no CalDAV
//    documentation of its own for this; the source is third-party:
//    https://cli.nylas.com/guides/icloud-caldav-settings (2026-11-24), in agreement with several client projects.
//  - UNVERIFIED: whether the partition host is reached through an HTTP redirect or only through absolute hrefs in
//    the answers. Both are handled: redirects are followed by hand (so that the method, the body and the
//    credentials survive), and hrefs are resolved against the URL that answered. Either way the credentials only
//    go to https hosts under the configured server's domain.
//  - UNVERIFIED: whether iCloud honours `<C:expand>` in a calendar-query. It is asked for; if the server refuses
//    the report, it is repeated without; if the server ignores it and returns the series with its RRULE, the
//    iCalendar reader expands it (see `ical.ts` for the supported forms).
//  - UNVERIFIED: whether iCloud returns an ETag on PUT; `etag` is simply absent from the result when it does not.
//  - UNVERIFIED: iCloud's request limits; nothing here retries.
//
// Protocol: PROPFIND/REPORT bodies and the 207 answers are RFC 4918 §9.1 and RFC 4791 §7.8; a new resource is
// PUT with `If-None-Match: *` (RFC 4791 §5.3.2), an existing one with `If-Match`.

import { busyFromICalendar, formatUtc, writeCalendar } from './ical.ts';
import { assertOurs, type BusyReading, CalendarError, type CalendarProvider, type CalendarRef, type StudioEvent, type WriteResult } from './types.ts';
import { bookingOfUid, uidForBooking } from './uid.ts';
import { child, type DavResponse, descendants, escapeXml, parseMultistatus } from './xml.ts';

export const ICLOUD_CALDAV = 'https://caldav.icloud.com/';

const DAV = 'xmlns:d="DAV:"';
const CALDAV = 'xmlns:c="urn:ietf:params:xml:ns:caldav"';
const CALENDARSERVER = 'xmlns:cs="http://calendarserver.org/ns/"';
const XML = '<?xml version="1.0" encoding="utf-8"?>';
const MAX_REDIRECTS = 5;

/** One account at a CalDAV server. For iCloud the password is an app-specific password, never the account's own. */
export interface CalDavAccount {
  /** Where discovery starts; `ICLOUD_CALDAV` for iCloud. */
  serverUrl: string;
  username: string;
  password: string;
}

export interface CalDavCalendar {
  /** The collection's URL: the `id` of its `CalendarRef`. */
  url: string;
  name: string;
  /** Changes whenever anything in the calendar does (the calendarserver.org `getctag` extension), if offered. */
  ctag?: string;
  /** Whether the account may write to it, where the server lists the privileges. */
  writable?: boolean;
}

export interface CalDavDiscovery {
  principal: string;
  home: string;
  calendars: CalDavCalendar[];
}

export interface CalDavObject {
  url: string;
  etag?: string;
  /** The iCalendar text. */
  data: string;
}

export type PutCondition = { create: true } | { ifMatch: string } | { overwrite: true };

export interface PutResult {
  /** `false`: the condition did not hold (412); nothing was written. */
  ok: boolean;
  etag?: string;
}

/** The `Authorization` value for Basic auth; the credentials may hold any Unicode (RFC 7617, UTF-8). */
export function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

/** The body of a PROPFIND for the named properties (`d:` DAV, `c:` CalDAV, `cs:` calendarserver.org). */
export function propfindBody(props: readonly string[]): string {
  return `${XML}<d:propfind ${DAV} ${CALDAV} ${CALENDARSERVER}><d:prop>${props.map((p) => `<${p}/>`).join('')}</d:prop></d:propfind>`;
}

/** The body of a `calendar-query` REPORT for the events that touch `[from, to)`. */
export function calendarQueryBody(from: number, to: number, expand: boolean): string {
  const range = `start="${formatUtc(from)}" end="${formatUtc(to)}"`;
  const data = expand ? `<c:calendar-data><c:expand ${range}/></c:calendar-data>` : '<c:calendar-data/>';
  return (
    `${XML}<c:calendar-query ${DAV} ${CALDAV}>` +
    `<d:prop><d:getetag/>${data}</d:prop>` +
    `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range ${range}/></c:comp-filter></c:comp-filter></c:filter>` +
    '</c:calendar-query>'
  );
}

/** The calendars among the responses of a `Depth: 1` PROPFIND on the home set: collections that hold events. */
export function calendarsFrom(responses: readonly DavResponse[], base: string): CalDavCalendar[] {
  const calendars: CalDavCalendar[] = [];
  for (const { href, props } of responses) {
    if (!child(props.resourcetype, 'calendar')) continue;
    const components = props['supported-calendar-component-set'];
    if (components && !components.children.some((c) => c.attributes.name?.toUpperCase() === 'VEVENT')) continue;
    const privileges = props['current-user-privilege-set'];
    const granted = privileges ? descendants(privileges, 'privilege').flatMap((p) => p.children.map((c) => c.name)) : undefined;
    const ctag = props.getctag?.text.trim();
    calendars.push({
      url: new URL(href, base).href,
      name: props.displayname?.text.trim() ?? '',
      ...(ctag ? { ctag } : {}),
      ...(granted ? { writable: granted.some((p) => p === 'write' || p === 'write-content' || p === 'all') } : {}),
    });
  }
  return calendars;
}

/** The URL of an event's resource in a calendar collection. */
export function resourceUrl(calendarUrl: string, uid: string): string {
  return `${calendarUrl.endsWith('/') ? calendarUrl : `${calendarUrl}/`}${encodeURIComponent(uid)}.ics`;
}

export class CalDavClient {
  readonly #fetch: typeof fetch;
  readonly #account: CalDavAccount;
  readonly #origin: URL;
  readonly #domain: string;

  constructor(options: { fetch: typeof fetch; account: CalDavAccount }) {
    this.#fetch = options.fetch;
    this.#account = options.account;
    this.#origin = new URL(options.account.serverUrl);
    // `caldav.icloud.com` trusts `p67-caldav.icloud.com`: the same domain, read as the host's last two labels.
    this.#domain = this.#origin.hostname.split('.').slice(-2).join('.');
  }

  /** Whether the credentials may be sent there: https, and the configured server or a host under its domain. */
  trusts(url: string): boolean {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return false;
    }
    if (target.protocol !== 'https:') return false;
    return target.hostname === this.#origin.hostname || target.hostname.endsWith(`.${this.#domain}`);
  }

  /** One authenticated request, following redirects by hand; resolves to the answer and the URL that gave it. */
  async request(method: string, url: string, headers: Record<string, string> = {}, body?: string): Promise<{ response: Response; url: string }> {
    let target = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!this.trusts(target)) throw new CalendarError('protocol', `Refusing to send the calendar credentials to ${target}`);
      const response = await this.#fetch(target, {
        method,
        redirect: 'manual',
        headers: { Authorization: basicAuth(this.#account.username, this.#account.password), ...headers },
        ...(body === undefined ? {} : { body }),
      });
      const location = response.headers.get('Location');
      if ([301, 302, 307, 308].includes(response.status) && location) {
        target = new URL(location, target).href;
        continue;
      }
      if (response.status === 401) throw new CalendarError('auth', 'The calendar server refused the credentials.', 401);
      return { response, url: target };
    }
    throw new CalendarError('protocol', 'Too many redirects from the calendar server.');
  }

  async #multistatus(method: 'PROPFIND' | 'REPORT', url: string, depth: '0' | '1', body: string): Promise<{ responses: DavResponse[]; url: string } | number> {
    const answer = await this.request(method, url, { Depth: depth, 'Content-Type': 'application/xml; charset=utf-8' }, body);
    if (answer.response.status !== 207) return answer.response.status;
    return { responses: parseMultistatus(await answer.response.text()), url: answer.url };
  }

  async #propfind(url: string, depth: '0' | '1', props: readonly string[]): Promise<{ responses: DavResponse[]; url: string }> {
    const answer = await this.#multistatus('PROPFIND', url, depth, propfindBody(props));
    if (typeof answer === 'number') throw failure(answer, `PROPFIND ${url}`);
    return answer;
  }

  /** The href inside the named property of the first response that has it, resolved against the answering URL. */
  async #hrefOf(url: string, prop: string): Promise<string> {
    const { responses, url: base } = await this.#propfind(url, '0', [prop.includes(':') ? prop : `d:${prop}`]);
    const name = prop.slice(prop.indexOf(':') + 1);
    for (const response of responses) {
      const href = child(response.props[name], 'href')?.text.trim();
      if (href) return new URL(href, base).href;
    }
    throw new CalendarError('protocol', `The calendar server did not name its ${name}.`);
  }

  /** Principal → calendar home → the calendars in it. Done once per account; the calendar URLs are then kept. */
  async discover(): Promise<CalDavDiscovery> {
    const principal = await this.#hrefOf(this.#origin.href, 'current-user-principal');
    const home = await this.#hrefOf(principal, 'c:calendar-home-set');
    return { principal, home, calendars: await this.calendars(home) };
  }

  /** The calendars of a home set, each with its current `ctag`: the cheap "did anything change" of a poll. */
  async calendars(home: string): Promise<CalDavCalendar[]> {
    const props = ['d:displayname', 'd:resourcetype', 'd:current-user-privilege-set', 'c:supported-calendar-component-set', 'cs:getctag'];
    const { responses, url } = await this.#propfind(home, '1', props);
    return calendarsFrom(responses, url);
  }

  /** The events that touch `[from, to)`, as iCalendar texts. */
  async query(calendarUrl: string, from: number, to: number, options: { expand?: boolean } = {}): Promise<CalDavObject[]> {
    const expand = options.expand ?? true;
    let answer = await this.#multistatus('REPORT', calendarUrl, '1', calendarQueryBody(from, to, expand));
    // A server that will not expand may refuse the whole report; the unexpanded data serves as well.
    if (typeof answer === 'number' && expand && answer >= 400 && answer !== 404) {
      answer = await this.#multistatus('REPORT', calendarUrl, '1', calendarQueryBody(from, to, false));
    }
    if (typeof answer === 'number') throw failure(answer, `REPORT ${calendarUrl}`);
    const base = answer.url;
    const objects: CalDavObject[] = [];
    for (const { href, props } of answer.responses) {
      const data = props['calendar-data']?.text;
      if (data === undefined || data.trim() === '') continue;
      const etag = props.getetag?.text.trim();
      objects.push({ url: new URL(href, base).href, data, ...(etag ? { etag } : {}) });
    }
    return objects;
  }

  /** Stores an iCalendar text at a URL, under a condition; `ok: false` when the condition did not hold. */
  async put(url: string, ics: string, condition: PutCondition): Promise<PutResult> {
    const headers: Record<string, string> = { 'Content-Type': 'text/calendar; charset=utf-8' };
    if ('create' in condition) headers['If-None-Match'] = '*';
    else if ('ifMatch' in condition) headers['If-Match'] = condition.ifMatch;
    const { response } = await this.request('PUT', url, headers, ics);
    if (response.status === 412) return { ok: false };
    if (response.status < 200 || response.status > 299) throw failure(response.status, `PUT ${url}`);
    const etag = response.headers.get('ETag');
    return { ok: true, ...(etag ? { etag } : {}) };
  }

  /** Deletes a resource; `false` when it was not there. With `etag`, only that version (else a `conflict`). */
  async delete(url: string, etag?: string): Promise<boolean> {
    const { response } = await this.request('DELETE', url, etag === undefined ? {} : { 'If-Match': etag });
    if (response.status === 404 || response.status === 410) return false;
    if (response.status === 412) throw new CalendarError('conflict', 'The event changed since it was read.', 412);
    if (response.status < 200 || response.status > 299) throw failure(response.status, `DELETE ${url}`);
    return true;
  }
}

function failure(status: number, what: string): CalendarError {
  if (status === 404) return new CalendarError('not-found', `${what}: not found`, 404);
  return new CalendarError('http', `${what}: HTTP ${status}`, status);
}

/**
 * The provider over CalDAV: iCloud, or any other CalDAV server. A `CalendarRef.id` is the calendar collection's
 * URL, as `discover()` lists it. Polled; no push.
 */
export class CalDavProvider implements CalendarProvider {
  readonly name = 'caldav';
  readonly capabilities = { canWrite: true, hasPush: false } as const;
  readonly client: CalDavClient;
  readonly #now: () => number;
  readonly #zone: string | undefined;

  /** `now` stamps the events we write; `zone` overrides the studio's zone for floating and all-day entries. */
  constructor(options: { fetch: typeof fetch; account: CalDavAccount; now: () => number; zone?: string }) {
    this.client = new CalDavClient(options);
    this.#now = options.now;
    this.#zone = options.zone;
  }

  async busy(calendar: CalendarRef, from: number, to: number): Promise<BusyReading> {
    const objects = await this.client.query(calendar.id, from, to);
    return busyFromICalendar(
      objects.map((o) => o.data),
      from,
      to,
      this.#zone,
    );
  }

  #text(event: StudioEvent): { uid: string; ics: string } {
    const uid = uidForBooking(event.bookingId);
    const { start, end, summary, description, location } = event;
    return { uid, ics: writeCalendar({ uid, start, end, summary, description, location, stamp: this.#now() }) };
  }

  async write(calendar: CalendarRef, event: StudioEvent): Promise<WriteResult> {
    assertOurs(calendar);
    const { uid, ics } = this.#text(event);
    const url = resourceUrl(calendar.id, uid);
    const created = await this.client.put(url, ics, { create: true });
    if (created.ok) return { eventId: uid, created: true, ...(created.etag ? { etag: created.etag } : {}) };
    // It is there already, and it is ours (the name is our UID): bring it to this content.
    const replaced = await this.client.put(url, ics, { overwrite: true });
    return { eventId: uid, created: false, ...(replaced.etag ? { etag: replaced.etag } : {}) };
  }

  async update(calendar: CalendarRef, event: StudioEvent, etag?: string): Promise<WriteResult> {
    assertOurs(calendar);
    const { uid, ics } = this.#text(event);
    // `If-Match: *` holds for any existing version, and fails where there is none.
    const result = await this.client.put(resourceUrl(calendar.id, uid), ics, { ifMatch: etag ?? '*' });
    if (!result.ok) {
      throw etag === undefined
        ? new CalendarError('not-found', 'There is no such event to update.', 412)
        : new CalendarError('conflict', 'The event changed since it was read, or is gone.', 412);
    }
    return { eventId: uid, created: false, ...(result.etag ? { etag: result.etag } : {}) };
  }

  async remove(calendar: CalendarRef, bookingId: string, etag?: string): Promise<{ removed: boolean }> {
    assertOurs(calendar);
    return { removed: await this.client.delete(resourceUrl(calendar.id, uidForBooking(bookingId)), etag) };
  }
}

/** The booking a CalDAV resource belongs to, by its name (`<uid>.ics`), or `undefined` for anyone else's. */
export function bookingOfResource(url: string): string | undefined {
  const name = /([^/]+)\.ics$/.exec(new URL(url).pathname)?.[1];
  return name === undefined ? undefined : bookingOfUid(decodeURIComponent(name));
}
