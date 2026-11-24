import { describe, expect, test } from 'bun:test';

import { busyFromICalendar, escapeText, fold, formatUtc, parseCalendar, parseDuration, parseLine, unescapeText, unfold, writeCalendar } from './ical.ts';
import type { BusyInterval } from './types.ts';
import { DAY, HOUR } from './zone.ts';

/** An instant from UTC fields; months are 1-12. */
const utc = (y: number, mo: number, d: number, h = 0, mi = 0): number => Date.UTC(y, mo - 1, d, h, mi);

/** A calendar text around the given VEVENT lines (one array per event). */
function calendar(...events: string[][]): string {
  const body = events.flatMap((lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Example//Test//EN', ...body, 'END:VCALENDAR', ''].join('\r\n');
}

const YEAR_2026: [number, number] = [utc(2026, 1, 1), utc(2027, 1, 1)];
const busy = (text: string | string[], [from, to]: [number, number] = YEAR_2026) => busyFromICalendar(text, from, to);
const starts = (intervals: BusyInterval[]): string[] => intervals.map((i) => formatUtc(i.start));

describe('content lines', () => {
  test('folded lines are joined, whether folded with a space or a tab, CRLF or LF', () => {
    expect(unfold('SUMMARY:Reh\r\n earsal\r\nLOCATION:Stu\n\tdio\r\n\r\nUID:1')).toEqual(['SUMMARY:Rehearsal', 'LOCATION:Studio', 'UID:1']);
  });

  test('a line has a name, parameters and a value', () => {
    expect(parseLine('dtstart;TZID=Europe/Prague;VALUE=DATE-TIME:20261124T180000')).toEqual({
      name: 'DTSTART',
      params: { TZID: 'Europe/Prague', VALUE: 'DATE-TIME' },
      value: '20261124T180000',
    });
  });

  test('a quoted parameter may hold colons and semicolons; the value keeps its own', () => {
    expect(parseLine('ATTENDEE;CN="Novak; Jan: drums";ROLE=CHAIR:mailto:name@example.com')).toEqual({
      name: 'ATTENDEE',
      params: { CN: 'Novak; Jan: drums', ROLE: 'CHAIR' },
      value: 'mailto:name@example.com',
    });
  });

  test('a line without a value is no line', () => {
    expect(parseLine('GARBAGE')).toBeUndefined();
    expect(parseLine('X;A="unclosed:1')).toBeUndefined();
  });

  test('text is escaped and read back', () => {
    const text = 'Band; "Rehearsal", room 2\\3\nBring cables';
    expect(escapeText(text)).toBe('Band\\; "Rehearsal"\\, room 2\\\\3\\nBring cables');
    expect(unescapeText(escapeText(text))).toBe(text);
    expect(unescapeText('a\\Nb')).toBe('a\nb');
  });

  test('a long line is folded at 75 octets, never inside a character', () => {
    const line = `SUMMARY:${'Žluťoučký kůň '.repeat(12)}`;
    const folded = fold(line);
    const encoder = new TextEncoder();
    for (const part of folded.split('\r\n')) expect(encoder.encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.split('\r\n').length).toBeGreaterThan(2);
    expect(unfold(folded)).toEqual([line]);
    expect(fold('SUMMARY:short')).toBe('SUMMARY:short');
  });

  test('durations', () => {
    expect(parseDuration('PT1H30M')).toBe(1.5 * HOUR);
    expect(parseDuration('P1DT2H')).toBe(DAY + 2 * HOUR);
    expect(parseDuration('P2W')).toBe(14 * DAY);
    expect(parseDuration('-PT15M')).toBe(-15 * 60_000);
    expect(parseDuration('P')).toBeUndefined();
    expect(parseDuration('1 hour')).toBeUndefined();
  });
});

describe('each date form', () => {
  test('UTC', () => {
    const { intervals, problems } = busy(calendar(['UID:utc', 'DTSTART:20261124T170000Z', 'DTEND:20261124T200000Z']));
    expect(problems).toEqual([]);
    expect(intervals).toEqual([{ start: utc(2026, 11, 24, 17), end: utc(2026, 11, 24, 20), allDay: false, eventId: 'utc' }]);
  });

  test('floating is the studio’s wall clock, in winter and in summer', () => {
    const winter = busy(calendar(['UID:w', 'DTSTART:20261124T180000', 'DTEND:20261124T210000']));
    expect(winter.intervals).toEqual([{ start: utc(2026, 11, 24, 17), end: utc(2026, 11, 24, 20), allDay: false, eventId: 'w' }]);
    const summer = busy(calendar(['UID:s', 'DTSTART:20260714T180000', 'DTEND:20260714T210000']));
    expect(summer.intervals).toEqual([{ start: utc(2026, 7, 14, 16), end: utc(2026, 7, 14, 19), allDay: false, eventId: 's' }]);
  });

  test('TZID, with or without quotes, in Prague or elsewhere', () => {
    const prague = busy(calendar(['UID:p', 'DTSTART;TZID=Europe/Prague:20261124T180000', 'DTEND;TZID=Europe/Prague:20261124T210000']));
    expect(starts(prague.intervals)).toEqual(['20261124T170000Z']);
    const newYork = busy(calendar(['UID:n', 'DTSTART;TZID="America/New_York":20261124T120000', 'DTEND;TZID="America/New_York":20261124T130000']));
    expect(newYork.intervals).toEqual([{ start: utc(2026, 11, 24, 17), end: utc(2026, 11, 24, 18), allDay: false, eventId: 'n' }]);
  });

  test('an end in another zone than the start', () => {
    const { intervals } = busy(calendar(['UID:f', 'DTSTART;TZID=Europe/Prague:20261124T180000', 'DTEND;TZID=Europe/London:20261124T190000']));
    expect(intervals).toEqual([{ start: utc(2026, 11, 24, 17), end: utc(2026, 11, 24, 19), allDay: false, eventId: 'f' }]);
  });

  test('DURATION instead of DTEND', () => {
    const { intervals } = busy(calendar(['UID:d', 'DTSTART:20261124T170000Z', 'DURATION:PT2H30M']));
    expect(intervals).toEqual([{ start: utc(2026, 11, 24, 17), end: utc(2026, 11, 24, 19, 30), allDay: false, eventId: 'd' }]);
  });

  test('an event with neither end nor duration takes no time', () => {
    expect(busy(calendar(['UID:i', 'DTSTART:20261124T170000Z'])).intervals).toEqual([]);
  });

  test('a time zone Intl does not know is reported, not guessed', () => {
    const { intervals, problems } = busy(calendar(['UID:z', 'DTSTART;TZID=Central Europe Standard Time:20261124T180000', 'DURATION:PT1H']));
    expect(intervals).toEqual([]);
    expect(problems).toEqual([{ kind: 'unreadable-event', eventId: 'z', reason: 'DTSTART: unknown time zone "Central Europe Standard Time"' }]);
  });

  test('an event without a start is reported', () => {
    const { problems } = busy(calendar(['UID:nostart', 'SUMMARY:Broken']));
    expect(problems).toEqual([{ kind: 'unreadable-event', eventId: 'nostart', reason: 'no DTSTART' }]);
  });
});

describe('all-day events', () => {
  test('one day is Prague midnight to midnight', () => {
    const { intervals } = busy(calendar(['UID:a', 'DTSTART;VALUE=DATE:20261124', 'DTEND;VALUE=DATE:20261125']));
    expect(intervals).toEqual([{ start: utc(2026, 11, 23, 23), end: utc(2026, 11, 24, 23), allDay: true, eventId: 'a' }]);
  });

  test('without an end it is that one day; so it is when the end repeats the start', () => {
    const expected = [{ start: utc(2026, 7, 13, 22), end: utc(2026, 7, 14, 22), allDay: true, eventId: 'a' }];
    expect(busy(calendar(['UID:a', 'DTSTART;VALUE=DATE:20260714'])).intervals).toEqual(expected);
    expect(busy(calendar(['UID:a', 'DTSTART;VALUE=DATE:20260714', 'DTEND;VALUE=DATE:20260714'])).intervals).toEqual(expected);
  });

  test('the days the clocks change are 23 and 25 hours long', () => {
    const spring = busy(calendar(['UID:a', 'DTSTART;VALUE=DATE:20260329', 'DTEND;VALUE=DATE:20260330'])).intervals[0];
    expect(spring).toEqual({ start: utc(2026, 3, 28, 23), end: utc(2026, 3, 29, 22), allDay: true, eventId: 'a' });
    const autumn = busy(calendar(['UID:a', 'DTSTART;VALUE=DATE:20261025', 'DURATION:P1D'])).intervals[0];
    expect(autumn).toEqual({ start: utc(2026, 10, 24, 22), end: utc(2026, 10, 25, 23), allDay: true, eventId: 'a' });
    expect((spring?.end ?? 0) - (spring?.start ?? 0)).toBe(23 * HOUR);
    expect((autumn?.end ?? 0) - (autumn?.start ?? 0)).toBe(25 * HOUR);
  });

  test('several days, and a weekly all-day series', () => {
    const closed = busy(calendar(['UID:c', 'DTSTART;VALUE=DATE:20261224', 'DTEND;VALUE=DATE:20261227'])).intervals;
    expect(closed).toEqual([{ start: utc(2026, 12, 23, 23), end: utc(2026, 12, 26, 23), allDay: true, eventId: 'c' }]);
    const weekly = busy(calendar(['UID:w', 'DTSTART;VALUE=DATE:20261018', 'RRULE:FREQ=WEEKLY;COUNT=3'])).intervals;
    expect(starts(weekly)).toEqual(['20261017T220000Z', '20261024T220000Z', '20261031T230000Z']);
    expect(weekly.every((i) => i.allDay)).toBe(true);
  });
});

describe('what is not busy', () => {
  test('a cancelled event and a transparent one', () => {
    const text = calendar(
      ['UID:c', 'DTSTART:20261124T170000Z', 'DTEND:20261124T200000Z', 'STATUS:CANCELLED'],
      ['UID:t', 'DTSTART:20261124T170000Z', 'DTEND:20261124T200000Z', 'TRANSP:TRANSPARENT'],
      ['UID:o', 'DTSTART:20261124T170000Z', 'DTEND:20261124T200000Z', 'STATUS:TENTATIVE', 'TRANSP:OPAQUE'],
    );
    expect(busy(text).intervals.map((i) => i.eventId)).toEqual(['o']);
  });

  test('an event outside the window, or only touching it', () => {
    const text = calendar(['UID:e', 'DTSTART:20261124T170000Z', 'DTEND:20261124T200000Z']);
    expect(busy(text, [utc(2026, 11, 24, 20), utc(2026, 11, 25)]).intervals).toEqual([]);
    expect(busy(text, [utc(2026, 11, 24), utc(2026, 11, 24, 17)]).intervals).toEqual([]);
    expect(busy(text, [utc(2026, 11, 24, 19, 59), utc(2026, 11, 25)]).intervals).toHaveLength(1);
  });

  test('alarms and time zone definitions inside the calendar are not events', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'BEGIN:VTIMEZONE',
      'TZID:Europe/Prague',
      'BEGIN:STANDARD',
      'DTSTART:19701025T030000',
      'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
      'END:STANDARD',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'UID:alarmed',
      'DTSTART;TZID=Europe/Prague:20261124T180000',
      'BEGIN:VALARM',
      'TRIGGER:-PT15M',
      'DURATION:PT99H',
      'END:VALARM',
      'DTEND;TZID=Europe/Prague:20261124T210000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const parsed = parseCalendar(text);
    expect(parsed.events).toHaveLength(1);
    expect(busy(text)).toEqual({ intervals: [{ start: utc(2026, 11, 24, 17), end: utc(2026, 11, 24, 20), allDay: false, eventId: 'alarmed' }], problems: [] });
  });
});

describe('a weekly rehearsal', () => {
  const rehearsal = (...more: string[]): string[] => ['UID:rehearsal', 'SUMMARY:Rehearsal', 'DTSTART;TZID=Europe/Prague:20260317T180000', 'DTEND;TZID=Europe/Prague:20260317T210000', ...more];

  test('stays at 18:00 Prague time across the change to summer time, minus an EXDATE, with one evening moved', () => {
    const text = calendar(
      rehearsal('RRULE:FREQ=WEEKLY', 'EXDATE;TZID=Europe/Prague:20260324T180000'),
      // The rehearsal of Tuesday 31 March was moved to Wednesday, 19:00-20:00.
      ['UID:rehearsal', 'RECURRENCE-ID;TZID=Europe/Prague:20260331T180000', 'DTSTART;TZID=Europe/Prague:20260401T190000', 'DTEND;TZID=Europe/Prague:20260401T200000'],
    );
    const { intervals, problems } = busy(text, [utc(2026, 3, 16), utc(2026, 4, 15)]);
    expect(problems).toEqual([]);
    expect(intervals).toEqual([
      { start: utc(2026, 3, 17, 17), end: utc(2026, 3, 17, 20), allDay: false, eventId: 'rehearsal' },
      { start: utc(2026, 4, 1, 17), end: utc(2026, 4, 1, 18), allDay: false, eventId: 'rehearsal' },
      { start: utc(2026, 4, 7, 16), end: utc(2026, 4, 7, 19), allDay: false, eventId: 'rehearsal' },
      { start: utc(2026, 4, 14, 16), end: utc(2026, 4, 14, 19), allDay: false, eventId: 'rehearsal' },
    ]);
  });

  test('and across the change back to winter time', () => {
    const { intervals } = busy(calendar(rehearsal('RRULE:FREQ=WEEKLY')), [utc(2026, 10, 12), utc(2026, 11, 9)]);
    expect(starts(intervals)).toEqual(['20261013T160000Z', '20261020T160000Z', '20261027T170000Z', '20261103T170000Z']);
    expect(intervals.every((i) => i.end - i.start === 3 * HOUR)).toBe(true);
  });

  test('the override may be written in UTC, come before the series, or in another text', () => {
    const override = ['UID:rehearsal', 'RECURRENCE-ID:20260331T160000Z', 'DTSTART:20260401T170000Z', 'DTEND:20260401T180000Z'];
    const window: [number, number] = [utc(2026, 3, 30), utc(2026, 4, 8)];
    const expected = ['20260401T170000Z', '20260407T160000Z'];
    expect(starts(busy(calendar(override, rehearsal('RRULE:FREQ=WEEKLY')), window).intervals)).toEqual(expected);
    expect(starts(busy([calendar(rehearsal('RRULE:FREQ=WEEKLY')), calendar(override)], window).intervals)).toEqual(expected);
  });

  test('a cancelled occurrence is gone; an EXDATE given as a date removes that day’s', () => {
    const cancelled = ['UID:rehearsal', 'RECURRENCE-ID;TZID=Europe/Prague:20260407T180000', 'DTSTART;TZID=Europe/Prague:20260407T180000', 'DURATION:PT3H', 'STATUS:CANCELLED'];
    const text = calendar(rehearsal('RRULE:FREQ=WEEKLY', 'EXDATE;VALUE=DATE:20260414', 'EXDATE:20260421T160000Z,20260428T160000Z'), cancelled);
    expect(starts(busy(text, [utc(2026, 4, 1), utc(2026, 5, 13)]).intervals)).toEqual(['20260505T160000Z', '20260512T160000Z']);
  });

  test('an override moved into the window counts, one moved out of it does not', () => {
    const movedIn = ['UID:rehearsal', 'RECURRENCE-ID;TZID=Europe/Prague:20260421T180000', 'DTSTART;TZID=Europe/Prague:20260410T100000', 'DURATION:PT1H'];
    const text = calendar(rehearsal('RRULE:FREQ=WEEKLY'), movedIn);
    expect(starts(busy(text, [utc(2026, 4, 9), utc(2026, 4, 11)]).intervals)).toEqual(['20260410T080000Z']);
    expect(starts(busy(text, [utc(2026, 4, 20), utc(2026, 4, 23)]).intervals)).toEqual([]);
  });

  test('COUNT counts the excluded evenings too', () => {
    const text = calendar(rehearsal('RRULE:FREQ=WEEKLY;COUNT=4', 'EXDATE;TZID=Europe/Prague:20260324T180000'));
    expect(starts(busy(text).intervals)).toEqual(['20260317T170000Z', '20260331T160000Z', '20260407T160000Z']);
  });

  test('UNTIL is inclusive, as an instant or as a date', () => {
    const until = (value: string): string[] => starts(busy(calendar(rehearsal(`RRULE:FREQ=WEEKLY;UNTIL=${value}`))).intervals);
    expect(until('20260331T160000Z')).toEqual(['20260317T170000Z', '20260324T170000Z', '20260331T160000Z']);
    expect(until('20260331T155959Z')).toEqual(['20260317T170000Z', '20260324T170000Z']);
    expect(until('20260331')).toEqual(['20260317T170000Z', '20260324T170000Z', '20260331T160000Z']);
  });

  test('a series that began years ago is found without walking through the years', () => {
    const old = ['UID:old', 'DTSTART;TZID=Europe/Prague:20100105T180000', 'DTEND;TZID=Europe/Prague:20100105T210000', 'RRULE:FREQ=WEEKLY'];
    const { intervals } = busy(calendar(old), [utc(2026, 11, 23), utc(2026, 11, 30)]);
    expect(starts(intervals)).toEqual(['20261124T170000Z']);
  });

  test('an occurrence that began before the window and reaches into it counts', () => {
    const overnight = ['UID:night', 'DTSTART;TZID=Europe/Prague:20260317T220000', 'DURATION:PT6H', 'RRULE:FREQ=WEEKLY'];
    expect(starts(busy(calendar(overnight), [utc(2026, 11, 25, 1), utc(2026, 11, 25, 2)]).intervals)).toEqual(['20261124T210000Z']);
  });
});

describe('the other supported rules', () => {
  test('WEEKLY with BYDAY and INTERVAL: Monday, Wednesday and Friday of every other week', () => {
    const text = calendar(['UID:mwf', 'DTSTART;TZID=Europe/Prague:20261102T090000', 'DURATION:PT1H', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=7']);
    expect(starts(busy(text).intervals)).toEqual([
      '20261102T080000Z',
      '20261104T080000Z',
      '20261106T080000Z',
      '20261116T080000Z',
      '20261118T080000Z',
      '20261120T080000Z',
      '20261130T080000Z',
    ]);
  });

  test('WKST decides which days share a week with the start', () => {
    // RFC 5545 §3.3.10: Tuesday and Sunday of every other week from Tuesday 5 August 1997.
    const rule = (wkst: string): string => calendar(['UID:w', 'DTSTART:19970805T090000Z', 'DURATION:PT1H', `RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=${wkst}`]);
    const window: [number, number] = [utc(1997, 8, 1), utc(1997, 9, 30)];
    expect(starts(busy(rule('MO'), window).intervals)).toEqual(['19970805T090000Z', '19970810T090000Z', '19970819T090000Z', '19970824T090000Z']);
    expect(starts(busy(rule('SU'), window).intervals)).toEqual(['19970805T090000Z', '19970817T090000Z', '19970819T090000Z', '19970831T090000Z']);
  });

  test('DAILY, with INTERVAL and with BYDAY', () => {
    const everyThird = calendar(['UID:d', 'DTSTART;TZID=Europe/Prague:20261023T100000', 'DURATION:PT1H', 'RRULE:FREQ=DAILY;INTERVAL=3;COUNT=3']);
    expect(starts(busy(everyThird).intervals)).toEqual(['20261023T080000Z', '20261026T090000Z', '20261029T090000Z']);
    const workdays = calendar(['UID:d', 'DTSTART;TZID=Europe/Prague:20261119T100000', 'DURATION:PT1H', 'RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20261124T235959Z']);
    expect(starts(busy(workdays).intervals)).toEqual(['20261119T090000Z', '20261120T090000Z', '20261123T090000Z', '20261124T090000Z']);
  });

  test('plain MONTHLY skips the months that lack the day', () => {
    const text = calendar(['UID:m', 'DTSTART;TZID=Europe/Prague:20260131T100000', 'DURATION:PT1H', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=31']);
    expect(starts(busy(text, [utc(2026, 1, 1), utc(2026, 6, 1)]).intervals)).toEqual(['20260131T090000Z', '20260331T080000Z', '20260531T080000Z']);
  });

  test('plain YEARLY, also for 29 February', () => {
    const closed = calendar(['UID:y', 'DTSTART;VALUE=DATE:20200101', 'RRULE:FREQ=YEARLY']);
    expect(starts(busy(closed, [utc(2026, 1, 1), utc(2027, 12, 31)]).intervals)).toEqual(['20251231T230000Z', '20261231T230000Z']);
    const leap = calendar(['UID:l', 'DTSTART;VALUE=DATE:20240229', 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29']);
    expect(starts(busy(leap, [utc(2025, 1, 1), utc(2029, 1, 1)]).intervals)).toEqual(['20280228T230000Z']);
  });

  test('instances a server has already expanded are read as they are', () => {
    const text = calendar(
      ['UID:rehearsal', 'RECURRENCE-ID:20261117T170000Z', 'DTSTART:20261117T170000Z', 'DTEND:20261117T200000Z'],
      ['UID:rehearsal', 'RECURRENCE-ID:20261124T170000Z', 'DTSTART:20261124T170000Z', 'DTEND:20261124T200000Z'],
    );
    expect(busy(text)).toEqual({
      intervals: [
        { start: utc(2026, 11, 17, 17), end: utc(2026, 11, 17, 20), allDay: false, eventId: 'rehearsal' },
        { start: utc(2026, 11, 24, 17), end: utc(2026, 11, 24, 20), allDay: false, eventId: 'rehearsal' },
      ],
      problems: [],
    });
  });
});

describe('unsupported recurrences fail loudly', () => {
  const event = (...more: string[]): string => calendar(['UID:odd', 'DTSTART;TZID=Europe/Prague:20261102T180000', 'DURATION:PT2H', ...more]);

  test.each([
    ['FREQ=MONTHLY;BYDAY=1MO', 'BYDAY with FREQ=MONTHLY is not supported'],
    ['FREQ=WEEKLY;BYDAY=-1FR', 'BYDAY=-1FR (an ordinal or an unknown weekday) is not supported'],
    ['FREQ=MONTHLY;BYMONTHDAY=15', 'BYMONTHDAY=15 is not supported'],
    ['FREQ=MONTHLY;BYMONTHDAY=-1', 'BYMONTHDAY=-1 is not supported'],
    ['FREQ=YEARLY;BYMONTH=3', 'BYMONTH=3 is not supported'],
    ['FREQ=WEEKLY;BYMONTH=11', 'BYMONTH=11 is not supported'],
    ['FREQ=DAILY;BYSETPOS=1', 'BYSETPOS is not supported'],
    ['FREQ=DAILY;BYHOUR=9,18', 'BYHOUR is not supported'],
    ['FREQ=YEARLY;BYWEEKNO=20', 'BYWEEKNO is not supported'],
    ['FREQ=YEARLY;BYYEARDAY=100', 'BYYEARDAY is not supported'],
    ['FREQ=HOURLY;INTERVAL=4', 'FREQ=HOURLY is not supported'],
    ['INTERVAL=2', 'FREQ= is not supported'],
    ['FREQ=WEEKLY;INTERVAL=0', 'INTERVAL=0 is not a positive number'],
    ['FREQ=WEEKLY;UNTIL=someday', 'UNTIL: unreadable date "SOMEDAY"'],
  ])('%s', (rule, reason) => {
    const { intervals, problems } = busy(event(`RRULE:${rule}`));
    expect(problems).toEqual([{ kind: 'unsupported-recurrence', eventId: 'odd', rule, reason: `${reason}; only the first occurrence was counted` }]);
    // The first occurrence is certain, so it is still busy.
    expect(starts(intervals)).toEqual(['20261102T170000Z']);
  });

  test('two rules on one event', () => {
    const { intervals, problems } = busy(event('RRULE:FREQ=WEEKLY', 'RRULE:FREQ=DAILY;COUNT=2'));
    expect(problems.map((p) => p.kind === 'unsupported-recurrence' && p.rule)).toEqual(['FREQ=WEEKLY + FREQ=DAILY;COUNT=2']);
    expect(intervals).toHaveLength(1);
  });

  test('RDATE and EXRULE are named; the rest of the event is still read', () => {
    const rdate = busy(event('RDATE;TZID=Europe/Prague:20261109T180000'));
    expect(rdate.problems.map((p) => p.kind === 'unsupported-recurrence' && p.rule)).toEqual(['RDATE']);
    expect(starts(rdate.intervals)).toEqual(['20261102T170000Z']);
    const exrule = busy(event('RRULE:FREQ=WEEKLY;COUNT=2', 'EXRULE:FREQ=WEEKLY;INTERVAL=2'));
    expect(exrule.problems.map((p) => p.kind === 'unsupported-recurrence' && p.rule)).toEqual(['EXRULE']);
    expect(exrule.intervals).toHaveLength(2);
  });

  test('an override of "this and all following" is named', () => {
    const text = calendar(
      ['UID:odd', 'DTSTART;TZID=Europe/Prague:20261102T180000', 'DURATION:PT2H', 'RRULE:FREQ=WEEKLY;COUNT=3'],
      ['UID:odd', 'RECURRENCE-ID;RANGE=THISANDFUTURE;TZID=Europe/Prague:20261109T180000', 'DTSTART;TZID=Europe/Prague:20261109T190000', 'DURATION:PT2H'],
    );
    const { intervals, problems } = busy(text);
    expect(problems.map((p) => p.kind === 'unsupported-recurrence' && p.rule)).toEqual(['RECURRENCE-ID;RANGE=THISANDFUTURE']);
    expect(starts(intervals)).toEqual(['20261102T170000Z', '20261109T180000Z', '20261116T170000Z']);
  });

  test('a series too long to walk through is reported', () => {
    const text = calendar(['UID:long', 'DTSTART:10000101T000000Z', 'DURATION:PT1H', 'RRULE:FREQ=DAILY;COUNT=999999']);
    const { problems } = busy(text);
    expect(problems.map((p) => p.kind === 'unsupported-recurrence' && p.reason)).toEqual(['the series is longer than 200000 steps; only the first occurrence was counted']);
  });

  test('what is not busy anyway is nobody’s problem', () => {
    expect(busy(event('RRULE:FREQ=MONTHLY;BYDAY=1MO', 'TRANSP:TRANSPARENT'))).toEqual({ intervals: [], problems: [] });
    expect(busy(event('RRULE:FREQ=MONTHLY;BYDAY=1MO', 'STATUS:CANCELLED'))).toEqual({ intervals: [], problems: [] });
  });
});

describe('writing', () => {
  const event = {
    uid: 'gawstudio-booking-b1',
    start: utc(2026, 11, 24, 9),
    end: utc(2026, 11, 24, 13),
    summary: 'Recording: Novák, Jan; "quartet"',
    description: 'Line one\nLine two, with a comma',
    location: 'Studio A',
    stamp: utc(2026, 11, 20, 8, 30),
  };

  test('an event is written in UTC, opaque and confirmed, with CRLF line ends', () => {
    const text = writeCalendar(event);
    expect(text.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(text.split('\r\n')).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//G.A.W.Studio//Booking//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:gawstudio-booking-b1',
      'DTSTAMP:20261120T083000Z',
      'LAST-MODIFIED:20261120T083000Z',
      'DTSTART:20261124T090000Z',
      'DTEND:20261124T130000Z',
      'SUMMARY:Recording: Novák\\, Jan\\; "quartet"',
      'DESCRIPTION:Line one\\nLine two\\, with a comma',
      'LOCATION:Studio A',
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ]);
  });

  test('what is written reads back the same', () => {
    const text = writeCalendar({ ...event, summary: `Recording ${'ž'.repeat(120)}`, description: undefined, location: undefined });
    expect(text).not.toContain('DESCRIPTION');
    const parsed = parseCalendar(text);
    expect(parsed.events[0]?.summary).toBe(`Recording ${'ž'.repeat(120)}`);
    expect(busyFromICalendar(text, event.start, event.end)).toEqual({
      intervals: [{ start: event.start, end: event.end, allDay: false, eventId: 'gawstudio-booking-b1' }],
      problems: [],
    });
  });
});
