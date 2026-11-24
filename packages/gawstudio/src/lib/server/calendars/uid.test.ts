import { describe, expect, test } from 'bun:test';

import { bookingOfGoogleEventId, bookingOfUid, googleEventId, isOurUid, uidForBooking } from './uid.ts';

describe('the UID of our events', () => {
  test('is derived from the booking id, the same every time', () => {
    expect(uidForBooking('b-2026-0042')).toBe('gawstudio-booking-b-2026-0042');
    expect(uidForBooking('b-2026-0042')).toBe(uidForBooking('b-2026-0042'));
    expect(bookingOfUid('gawstudio-booking-b-2026-0042')).toBe('b-2026-0042');
  });

  test('holds no address', () => {
    expect(uidForBooking('x')).not.toContain('@');
  });

  test('anybody else’s UID is not ours', () => {
    expect(isOurUid('gawstudio-booking-7')).toBe(true);
    expect(isOurUid('3F2504E0-4F89-11D3-9A0C-0305E82C3301')).toBe(false);
    expect(isOurUid('gawstudio-booking-')).toBe(false);
    expect(isOurUid('gawstudio-booking-a b')).toBe(false);
    expect(isOurUid(undefined)).toBe(false);
  });

  test('a booking id that would not survive a URL or a header is refused', () => {
    expect(() => uidForBooking('')).toThrow(RangeError);
    expect(() => uidForBooking('a/b')).toThrow(RangeError);
    expect(() => uidForBooking('a\r\nb')).toThrow(RangeError);
    expect(() => uidForBooking('x'.repeat(65))).toThrow(RangeError);
  });
});

describe('the Google event id', () => {
  test('uses only the characters Google allows, and leads back to the booking', () => {
    for (const id of ['7', 'b-2026-0042', 'A.b_c-9', 'x'.repeat(64)]) {
      const eventId = googleEventId(id);
      expect(eventId).toMatch(/^[a-v0-9]{5,1024}$/);
      expect(bookingOfGoogleEventId(eventId)).toBe(id);
    }
  });

  test('differs per booking behind a constant start (the encoded prefix)', () => {
    expect(googleEventId('1').startsWith(googleEventId('2').slice(0, 24))).toBe(true);
    expect(googleEventId('1')).not.toBe(googleEventId('2'));
  });

  test('an event id of somebody else’s event names no booking', () => {
    expect(bookingOfGoogleEventId('4k2v0i3cqjh1e0t9v8r7m6n5o4')).toBeUndefined();
    expect(bookingOfGoogleEventId('NOT-BASE32HEX')).toBeUndefined();
    expect(bookingOfGoogleEventId('')).toBeUndefined();
  });
});
