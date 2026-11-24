import { describe, expect, test } from 'bun:test';

import { basicAuth, bookingOfResource, CalDavClient, CalDavProvider, calendarQueryBody, calendarsFrom, propfindBody, resourceUrl } from './caldav.ts';
import { scripted } from './testing.ts';
import { CalendarError, type CalendarRef, type StudioEvent } from './types.ts';
import { descendants, parseMultistatus, parseXml } from './xml.ts';

const account = { serverUrl: 'https://caldav.example.com/', username: 'name@example.com', password: 'abcd-efgh-ijkl-mnop' };
const AUTH = `Basic ${btoa('name@example.com:abcd-efgh-ijkl-mnop')}`;
const utc = (y: number, mo: number, d: number, h = 0): number => Date.UTC(y, mo - 1, d, h);
const multistatus = (body: string) => ({ status: 207, headers: { 'Content-Type': 'text/xml; charset=utf-8' }, body });

// Recorded-style answers, written by hand in the three shapes servers use: an upper-case `D:` prefix, a default
// namespace, and lower-case prefixes with absolute hrefs on another host.
const PRINCIPAL = `<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/</D:href>
    <D:propstat>
      <D:prop><D:current-user-principal><D:href>/1234567/principal/</D:href></D:current-user-principal></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;

const HOME = `<?xml version='1.0' encoding='UTF-8'?>
<multistatus xmlns='DAV:'>
  <response>
    <href>/1234567/principal/</href>
    <propstat>
      <prop>
        <calendar-home-set xmlns='urn:ietf:params:xml:ns:caldav'>
          <href xmlns='DAV:'>https://p67-caldav.example.com:443/1234567/calendars/</href>
        </calendar-home-set>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`;

const CALENDARS = `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">
  <d:response>
    <d:href>/1234567/calendars/</d:href>
    <d:propstat>
      <d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/1234567/calendars/studio/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Studio &amp; rehearsals</d:displayname>
        <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
        <cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set>
        <cs:getctag>HwoQEgwAAAh4</cs:getctag>
        <d:current-user-privilege-set>
          <d:privilege><d:read/></d:privilege>
          <d:privilege><d:write/></d:privilege>
        </d:current-user-privilege-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/1234567/calendars/holidays/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Holidays</d:displayname>
        <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
        <cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set>
        <d:current-user-privilege-set><d:privilege><d:read/></d:privilege></d:current-user-privilege-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
    <d:propstat>
      <d:prop><cs:getctag/></d:prop>
      <d:status>HTTP/1.1 404 Not Found</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/1234567/calendars/tasks/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Reminders</d:displayname>
        <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
        <cal:supported-calendar-component-set><cal:comp name="VTODO"/></cal:supported-calendar-component-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/1234567/calendars/inbox/</d:href>
    <d:propstat>
      <d:prop><d:resourcetype><d:collection/><cal:schedule-inbox/></d:resourcetype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

const STUDIO = 'https://p67-caldav.example.com/1234567/calendars/studio/';

const REHEARSAL = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:rehearsal-1', 'SUMMARY:Rehearsal <loud> & long', 'DTSTART;TZID=Europe/Prague:20261103T180000', 'DTEND;TZID=Europe/Prague:20261103T210000', 'RRULE:FREQ=WEEKLY', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
const SESSION = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:gawstudio-booking-b1', 'DTSTART:20261124T090000Z', 'DTEND:20261124T130000Z', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');

// One answer with the data in CDATA under `C:`, one with it entity-escaped under other prefixes.
const REPORT = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>/1234567/calendars/studio/rehearsal-1.ics</href>
    <propstat>
      <prop>
        <getetag>"mk5z3x0a"</getetag>
        <C:calendar-data><![CDATA[${REHEARSAL}]]></C:calendar-data>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>/1234567/calendars/studio/gawstudio-booking-b1.ics</href>
    <propstat>
      <prop>
        <getetag>&quot;mk5z3x0b&quot;</getetag>
        <C:calendar-data>${SESSION.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</C:calendar-data>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>/1234567/calendars/studio/broken.ics</href>
    <propstat>
      <prop><C:calendar-data/></prop>
      <status>HTTP/1.1 404 Not Found</status>
    </propstat>
  </response>
</multistatus>`;

const REPORT_ESCAPED = `<A:multistatus xmlns:A="DAV:" xmlns:B="urn:ietf:params:xml:ns:caldav"><A:response><A:href>rehearsal-1.ics</A:href><A:propstat><A:prop><A:getetag>"e1"</A:getetag><B:calendar-data>${REHEARSAL.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</B:calendar-data></A:prop><A:status>HTTP/1.1 200 OK</A:status></A:propstat></A:response></A:multistatus>`;

async function errorOf(action: Promise<unknown>): Promise<CalendarError | undefined> {
  try {
    await action;
  } catch (error) {
    if (error instanceof CalendarError) return error;
    throw error;
  }
  return undefined;
}

describe('request building', () => {
  test('Basic auth carries the app-specific password, UTF-8 safe', () => {
    expect(basicAuth('name@example.com', 'abcd-efgh-ijkl-mnop')).toBe(AUTH);
    // RFC 7617 §2.1: "test" with the password "123£".
    expect(basicAuth('test', '123£')).toBe('Basic dGVzdDoxMjPCow==');
  });

  test('a PROPFIND body is well-formed and names the properties', () => {
    const root = parseXml(propfindBody(['d:displayname', 'c:calendar-home-set', 'cs:getctag']));
    expect(descendants(root, 'prop')[0]?.children.map((c) => c.name)).toEqual(['displayname', 'calendar-home-set', 'getctag']);
  });

  test('a calendar-query asks for VEVENTs in the time range, expanded or not', () => {
    const from = utc(2026, 11, 23, 23);
    const to = utc(2026, 11, 30, 23);
    const expanded = parseXml(calendarQueryBody(from, to, true));
    expect(descendants(expanded, 'comp-filter').map((c) => c.attributes.name)).toEqual(['VCALENDAR', 'VEVENT']);
    expect(descendants(expanded, 'time-range')[0]?.attributes).toEqual({ start: '20261123T230000Z', end: '20261130T230000Z' });
    expect(descendants(expanded, 'expand')[0]?.attributes).toEqual({ start: '20261123T230000Z', end: '20261130T230000Z' });
    expect(descendants(expanded, 'prop')[0]?.children.map((c) => c.name)).toEqual(['getetag', 'calendar-data']);
    expect(calendarQueryBody(from, to, false)).not.toContain('expand');
    expect(calendarQueryBody(from, to, true)).toContain('xmlns:c="urn:ietf:params:xml:ns:caldav"');
  });

  test('an event’s resource is named after its UID', () => {
    expect(resourceUrl(STUDIO, 'gawstudio-booking-b1')).toBe(`${STUDIO}gawstudio-booking-b1.ics`);
    expect(resourceUrl(STUDIO.slice(0, -1), 'gawstudio-booking-b1')).toBe(`${STUDIO}gawstudio-booking-b1.ics`);
    expect(bookingOfResource(`${STUDIO}gawstudio-booking-b1.ics`)).toBe('b1');
    expect(bookingOfResource(`${STUDIO}rehearsal-1.ics`)).toBeUndefined();
  });
});

describe('discovery', () => {
  test('principal, then calendar home, then the calendars: three PROPFINDs', async () => {
    const { fetch, requests } = scripted([multistatus(PRINCIPAL), multistatus(HOME), multistatus(CALENDARS)]);
    const found = await new CalDavClient({ fetch, account }).discover();

    expect(found.principal).toBe('https://caldav.example.com/1234567/principal/');
    expect(found.home).toBe('https://p67-caldav.example.com/1234567/calendars/');
    expect(found.calendars).toEqual([
      { url: STUDIO, name: 'Studio & rehearsals', ctag: 'HwoQEgwAAAh4', writable: true },
      { url: 'https://p67-caldav.example.com/1234567/calendars/holidays/', name: 'Holidays', writable: false },
    ]);

    expect(requests.map((r) => `${r.method} ${r.url} depth=${r.headers.depth}`)).toEqual([
      'PROPFIND https://caldav.example.com/ depth=0',
      'PROPFIND https://caldav.example.com/1234567/principal/ depth=0',
      'PROPFIND https://p67-caldav.example.com/1234567/calendars/ depth=1',
    ]);
    for (const request of requests) {
      expect(request.headers.authorization).toBe(AUTH);
      expect(request.headers['content-type']).toBe('application/xml; charset=utf-8');
      expect(request.redirect).toBe('manual');
    }
    expect(requests[0]?.body).toContain('<d:current-user-principal/>');
    expect(requests[1]?.body).toContain('<c:calendar-home-set/>');
    expect(requests[2]?.body).toContain('<cs:getctag/>');
  });

  test('a redirect to the partition host is followed with the same method, body and credentials', async () => {
    const { fetch, requests } = scripted([
      { status: 301, headers: { Location: 'https://p67-caldav.example.com/' } },
      multistatus(PRINCIPAL),
      { status: 307, headers: { Location: '/1234567/principal2/' } },
      multistatus(HOME),
      multistatus(CALENDARS),
    ]);
    const found = await new CalDavClient({ fetch, account }).discover();
    expect(found.principal).toBe('https://p67-caldav.example.com/1234567/principal/');
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      'PROPFIND https://caldav.example.com/',
      'PROPFIND https://p67-caldav.example.com/',
      'PROPFIND https://p67-caldav.example.com/1234567/principal/',
      'PROPFIND https://p67-caldav.example.com/1234567/principal2/',
      'PROPFIND https://p67-caldav.example.com/1234567/calendars/',
    ]);
    expect(requests[1]?.body).toBe(requests[0]?.body);
    expect(requests[1]?.headers.authorization).toBe(AUTH);
  });

  test('the credentials never leave the server’s domain, nor https', async () => {
    const elsewhere = scripted([{ status: 302, headers: { Location: 'https://caldav.example.org/' } }]);
    expect((await errorOf(new CalDavClient({ fetch: elsewhere.fetch, account }).discover()))?.kind).toBe('protocol');
    expect(elsewhere.requests).toHaveLength(1);

    const client = new CalDavClient({ fetch: scripted([]).fetch, account });
    expect(client.trusts('https://p12-caldav.example.com/x')).toBe(true);
    expect(client.trusts('http://caldav.example.com/')).toBe(false);
    expect(client.trusts('https://example.com.evil.test/')).toBe(false);
    expect(client.trusts('https://notexample.com/')).toBe(false);
    expect((await errorOf(client.query('https://calendar.evil.test/c/', 0, 1)))?.kind).toBe('protocol');
  });

  test('a redirect loop ends', async () => {
    const { fetch, requests } = scripted(Array.from({ length: 10 }, () => ({ status: 302, headers: { Location: 'https://caldav.example.com/' } })));
    expect((await errorOf(new CalDavClient({ fetch, account }).discover()))?.kind).toBe('protocol');
    expect(requests).toHaveLength(6);
  });

  test('refused credentials are an auth error: the app-specific password was revoked', async () => {
    const { fetch } = scripted([{ status: 401, headers: { 'WWW-Authenticate': 'Basic realm="x"' } }]);
    const error = await errorOf(new CalDavClient({ fetch, account }).discover());
    expect(error?.kind).toBe('auth');
    expect(error?.status).toBe(401);
  });

  test('an answer that names no principal is a protocol error', async () => {
    const { fetch } = scripted([multistatus('<multistatus xmlns="DAV:"/>')]);
    expect((await errorOf(new CalDavClient({ fetch, account }).discover()))?.kind).toBe('protocol');
  });

  test('calendars are the collections that hold events', () => {
    const calendars = calendarsFrom(parseMultistatus(CALENDARS), 'https://p67-caldav.example.com/1234567/calendars/');
    expect(calendars.map((c) => c.name)).toEqual(['Studio & rehearsals', 'Holidays']);
  });
});

describe('the calendar-query REPORT', () => {
  test('returns each event’s text and etag, whether in CDATA or escaped', async () => {
    const { fetch, requests } = scripted([multistatus(REPORT)]);
    const objects = await new CalDavClient({ fetch, account }).query(STUDIO, utc(2026, 11, 23), utc(2026, 11, 30));
    expect(objects).toEqual([
      { url: `${STUDIO}rehearsal-1.ics`, etag: '"mk5z3x0a"', data: REHEARSAL },
      { url: `${STUDIO}gawstudio-booking-b1.ics`, etag: '"mk5z3x0b"', data: SESSION },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('REPORT');
    expect(requests[0]?.url).toBe(STUDIO);
    expect(requests[0]?.headers.depth).toBe('1');
    expect(requests[0]?.body).toBe(calendarQueryBody(utc(2026, 11, 23), utc(2026, 11, 30), true));
  });

  test('other prefixes, a relative href, fully escaped data', async () => {
    const { fetch } = scripted([multistatus(REPORT_ESCAPED)]);
    const objects = await new CalDavClient({ fetch, account }).query(STUDIO, 0, 1);
    expect(objects).toEqual([{ url: `${STUDIO}rehearsal-1.ics`, etag: '"e1"', data: REHEARSAL }]);
  });

  test('a server that refuses to expand is asked again without', async () => {
    const { fetch, requests } = scripted([{ status: 403 }, multistatus(REPORT)]);
    const objects = await new CalDavClient({ fetch, account }).query(STUDIO, 0, 1);
    expect(objects).toHaveLength(2);
    expect(requests[0]?.body).toContain('expand');
    expect(requests[1]?.body).not.toContain('expand');
  });

  test('a calendar that is gone is not found', async () => {
    const { fetch, requests } = scripted([{ status: 404 }]);
    expect((await errorOf(new CalDavClient({ fetch, account }).query(STUDIO, 0, 1)))?.kind).toBe('not-found');
    expect(requests).toHaveLength(1);
    const failing = scripted([{ status: 500 }, { status: 500 }]);
    const error = await errorOf(new CalDavClient({ fetch: failing.fetch, account }).query(STUDIO, 0, 1));
    expect([error?.kind, error?.status]).toEqual(['http', 500]);
  });
});

describe('the provider', () => {
  const studio: CalendarRef = { id: STUDIO, ours: true };
  const personal: CalendarRef = { id: 'https://p67-caldav.example.com/1234567/calendars/home/', ours: false };
  const now = (): number => utc(2026, 11, 20, 8);
  const session: StudioEvent = { bookingId: 'b1', start: utc(2026, 11, 24, 9), end: utc(2026, 11, 24, 13), summary: 'Recording, 4 h' };
  const RESOURCE = `${STUDIO}gawstudio-booking-b1.ics`;

  test('says what it can do', () => {
    expect(new CalDavProvider({ fetch: scripted([]).fetch, account, now }).capabilities).toEqual({ canWrite: true, hasPush: false });
  });

  test('busy expands what the server did not, and keeps the UIDs', async () => {
    const { fetch } = scripted([multistatus(REPORT)]);
    const reading = await new CalDavProvider({ fetch, account, now }).busy(studio, utc(2026, 11, 23), utc(2026, 11, 30));
    expect(reading).toEqual({
      intervals: [
        { start: utc(2026, 11, 24, 9), end: utc(2026, 11, 24, 13), allDay: false, eventId: 'gawstudio-booking-b1' },
        { start: utc(2026, 11, 24, 17), end: utc(2026, 11, 24, 20), allDay: false, eventId: 'rehearsal-1' },
      ],
      problems: [],
    });
  });

  test('write creates with If-None-Match: *', async () => {
    const { fetch, requests } = scripted([{ status: 201, headers: { ETag: '"v1"' } }]);
    const result = await new CalDavProvider({ fetch, account, now }).write(studio, session);
    expect(result).toEqual({ eventId: 'gawstudio-booking-b1', created: true, etag: '"v1"' });
    expect(requests).toHaveLength(1);
    const put = requests[0];
    expect([put?.method, put?.url]).toEqual(['PUT', RESOURCE]);
    expect(put?.headers['if-none-match']).toBe('*');
    expect(put?.headers['if-match']).toBeUndefined();
    expect(put?.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(put?.headers.authorization).toBe(AUTH);
    expect(put?.body).toContain('UID:gawstudio-booking-b1\r\n');
    expect(put?.body).toContain('DTSTAMP:20261120T080000Z\r\n');
    expect(put?.body).toContain('DTSTART:20261124T090000Z\r\nDTEND:20261124T130000Z\r\n');
    expect(put?.body).toContain('SUMMARY:Recording\\, 4 h\r\n');
  });

  test('writing a booking that is already there replaces it, without a condition', async () => {
    const { fetch, requests } = scripted([{ status: 412 }, { status: 204 }]);
    const result = await new CalDavProvider({ fetch, account, now }).write(studio, session);
    expect(result).toEqual({ eventId: 'gawstudio-booking-b1', created: false });
    expect<unknown>(requests.map((r) => [r.method, r.url, r.headers['if-none-match'], r.headers['if-match']])).toEqual([
      ['PUT', RESOURCE, '*', undefined],
      ['PUT', RESOURCE, undefined, undefined],
    ]);
    expect(requests[1]?.body).toBe(requests[0]?.body);
  });

  test('update sends If-Match: the etag, or * for "whatever version, but it must exist"', async () => {
    const { fetch, requests } = scripted([{ status: 204, headers: { ETag: '"v2"' } }, { status: 204 }]);
    const provider = new CalDavProvider({ fetch, account, now });
    expect(await provider.update(studio, session, '"v1"')).toEqual({ eventId: 'gawstudio-booking-b1', created: false, etag: '"v2"' });
    expect(await provider.update(studio, session)).toEqual({ eventId: 'gawstudio-booking-b1', created: false });
    expect<unknown>(requests.map((r) => [r.method, r.url, r.headers['if-match'], r.headers['if-none-match']])).toEqual([
      ['PUT', RESOURCE, '"v1"', undefined],
      ['PUT', RESOURCE, '*', undefined],
    ]);
  });

  test('a failed precondition on update is a conflict with an etag, not-found without', async () => {
    const { fetch } = scripted([{ status: 412 }, { status: 412 }]);
    const provider = new CalDavProvider({ fetch, account, now });
    expect((await errorOf(provider.update(studio, session, '"old"')))?.kind).toBe('conflict');
    expect((await errorOf(provider.update(studio, session)))?.kind).toBe('not-found');
  });

  test('remove sends DELETE, with If-Match when a version is given', async () => {
    const { fetch, requests } = scripted([{ status: 204 }, { status: 204 }, { status: 404 }, { status: 412 }]);
    const provider = new CalDavProvider({ fetch, account, now });
    expect(await provider.remove(studio, 'b1')).toEqual({ removed: true });
    expect(await provider.remove(studio, 'b1', '"v2"')).toEqual({ removed: true });
    expect(await provider.remove(studio, 'b1')).toEqual({ removed: false });
    expect((await errorOf(provider.remove(studio, 'b1', '"old"')))?.kind).toBe('conflict');
    expect<unknown>(requests.map((r) => [r.method, r.url, r.headers['if-match'], r.body])).toEqual([
      ['DELETE', RESOURCE, undefined, undefined],
      ['DELETE', RESOURCE, '"v2"', undefined],
      ['DELETE', RESOURCE, undefined, undefined],
      ['DELETE', RESOURCE, '"old"', undefined],
    ]);
  });

  test('a personal calendar is never written: no request leaves', async () => {
    const { fetch, requests } = scripted([]);
    const provider = new CalDavProvider({ fetch, account, now });
    expect((await errorOf(provider.write(personal, session)))?.kind).toBe('read-only');
    expect((await errorOf(provider.update(personal, session)))?.kind).toBe('read-only');
    expect((await errorOf(provider.remove(personal, 'b1')))?.kind).toBe('read-only');
    expect(requests).toEqual([]);
  });

  test('a server error on PUT is reported with its status', async () => {
    const { fetch } = scripted([{ status: 507 }]);
    const error = await errorOf(new CalDavProvider({ fetch, account, now }).write(studio, session));
    expect([error?.kind, error?.status]).toEqual(['http', 507]);
  });
});
