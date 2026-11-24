// The identity of the events we write. It is derived from the booking's id, never random: writing the same
// booking twice addresses the same event, and an event read back from the studio's calendar is recognisably ours.

const PREFIX = 'gawstudio-booking-';
const BOOKING_ID = /^[A-Za-z0-9._-]{1,64}$/;
const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';

/** The iCalendar UID of a booking's event; also the name of its CalDAV resource (`<uid>.ics`). */
export function uidForBooking(bookingId: string): string {
  if (!BOOKING_ID.test(bookingId)) throw new RangeError('A booking id is 1-64 letters, digits, dots, dashes or underscores.');
  return PREFIX + bookingId;
}

/** The booking a UID belongs to, or `undefined` for anyone else's event. */
export function bookingOfUid(uid: string | undefined): string | undefined {
  if (uid === undefined || !uid.startsWith(PREFIX)) return undefined;
  const id = uid.slice(PREFIX.length);
  return BOOKING_ID.test(id) ? id : undefined;
}

export function isOurUid(uid: string | undefined): boolean {
  return bookingOfUid(uid) !== undefined;
}

/**
 * The Google event id of a booking: the UID in base32hex, since Google allows only `a`-`v` and `0`-`9` there
 * (5-1024 characters).
 */
export function googleEventId(bookingId: string): string {
  const bytes = new TextEncoder().encode(uidForBooking(bookingId));
  let out = '';
  let bits = 0;
  let acc = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32HEX.charAt((acc >> bits) & 31);
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32HEX.charAt((acc << (5 - bits)) & 31);
  return out;
}

/** The booking a Google event id belongs to, or `undefined` for an event we did not create. */
export function bookingOfGoogleEventId(eventId: string): string | undefined {
  let bits = 0;
  let acc = 0;
  let text = '';
  for (const ch of eventId) {
    const v = BASE32HEX.indexOf(ch);
    if (v < 0) return undefined;
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      text += String.fromCharCode((acc >> bits) & 255);
      acc &= (1 << bits) - 1;
    }
  }
  const id = bookingOfUid(text);
  // Only the exact encoding counts, so that an id maps to one booking and back.
  return id !== undefined && googleEventId(id) === eventId ? id : undefined;
}
