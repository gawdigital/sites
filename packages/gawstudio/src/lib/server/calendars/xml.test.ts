import { describe, expect, test } from 'bun:test';

import { child, decodeEntities, descendants, escapeXml, parseMultistatus, parseXml } from './xml.ts';

describe('the XML reader', () => {
  test('knows elements by their local name, whatever the prefix', () => {
    const root = parseXml('<?xml version="1.0"?><D:a xmlns:D="DAV:"><D:b>one</D:b><x:b xmlns:x="urn:x">two</x:b><b>three</b></D:a>');
    expect(descendants(root, 'b').map((n) => n.text)).toEqual(['one', 'two', 'three']);
    expect(child(root, 'a')?.attributes.D).toBe('DAV:');
  });

  test('reads attributes in either quote, self-closing elements, comments and doctypes', () => {
    const root = parseXml(`<!DOCTYPE a><a><!-- <b>no</b> --><comp name="VEVENT"/><comp name='VTODO' /><c>x</c></a>`);
    const a = child(root, 'a');
    expect(a?.children.map((n) => n.name)).toEqual(['comp', 'comp', 'c']);
    expect<unknown>(a?.children.map((n) => n.attributes.name)).toEqual(['VEVENT', 'VTODO', undefined]);
  });

  test('decodes entities and keeps CDATA as it is', () => {
    expect(child(parseXml('<a>1 &lt; 2 &amp;&amp; &#65;&#x42; &quot;q&quot; &unknown;</a>'), 'a')?.text).toBe('1 < 2 && AB "q" &unknown;');
    expect(child(parseXml('<a><![CDATA[BEGIN:VCALENDAR\r\n<&amp;>]]></a>'), 'a')?.text).toBe('BEGIN:VCALENDAR\r\n<&amp;>');
    expect(decodeEntities('&apos;&gt;')).toBe("'>");
  });

  test('is tolerant: a stray closing tag, an unclosed element, a bare "<"', () => {
    const root = parseXml('<a><b>1</c></b><d>2 < 3</d><e>');
    expect(descendants(root, 'b')[0]?.text).toBe('1');
    expect(descendants(root, 'd')[0]?.text).toBe('2 < 3');
    expect(descendants(root, 'e')).toHaveLength(1);
  });

  test('escapes what it writes', () => {
    expect(escapeXml('a<b>&"c"')).toBe('a&lt;b&gt;&amp;&quot;c&quot;');
  });
});

describe('a multistatus', () => {
  test('gives each response its href and the properties that were found', () => {
    const responses = parseMultistatus(`<?xml version="1.0" encoding="UTF-8"?>
      <multistatus xmlns="DAV:">
        <response>
          <href>/1234/calendars/work/</href>
          <propstat>
            <prop><displayname>Work &amp; play</displayname></prop>
            <status>HTTP/1.1 200 OK</status>
          </propstat>
          <propstat>
            <prop><getctag xmlns="http://calendarserver.org/ns/"/></prop>
            <status>HTTP/1.1 404 Not Found</status>
          </propstat>
        </response>
        <response>
          <href>/1234/calendars/gone.ics</href>
          <status>HTTP/1.1 404 Not Found</status>
        </response>
      </multistatus>`);
    expect(responses).toHaveLength(2);
    expect(responses[0]?.href).toBe('/1234/calendars/work/');
    expect(responses[0]?.props.displayname?.text).toBe('Work & play');
    expect(responses[0]?.props.getctag).toBeUndefined();
    expect(responses[1]?.status).toBe(404);
    expect(responses[1]?.props).toEqual({});
  });

  test('is empty for anything else', () => {
    expect(parseMultistatus('')).toEqual([]);
    expect(parseMultistatus('<html><body>Bad Request</body></html>')).toEqual([]);
  });
});
