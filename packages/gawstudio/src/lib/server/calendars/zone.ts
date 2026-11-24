// Wall clocks through Intl, never a fixed offset. A "wall" value is a wall-clock reading packed as if it were
// UTC (`Date.UTC(y, m, d, h, mi, s)`): date arithmetic on it stays in the wall clock, so a weekly 18:00 stays 18:00
// across a DST change, and it only becomes an instant through `wallToInstant`.

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatter(zone: string): Intl.DateTimeFormat | null {
  let f = formatters.get(zone);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      f = null;
    }
    formatters.set(zone, f);
  }
  return f;
}

/**
 * A `TZID` as a zone Intl knows, or `undefined`. Accepts IANA ids, and ids that end in one (the
 * `/freeassociation.sourceforge.net/Europe/Prague` style some clients write). Windows zone names are not mapped.
 */
export function resolveZone(tzid: string): string | undefined {
  const id = tzid.trim();
  if (id === '') return undefined;
  if (/^(utc|gmt|z|etc\/utc)$/i.test(id)) return 'UTC';
  if (formatter(id)) return id;
  const tail = /([A-Za-z_]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z_]+)?)$/.exec(id)?.[1];
  if (tail !== undefined && tail !== id) {
    if (formatter(tail)) return tail;
    const shorter = tail.slice(tail.indexOf('/') + 1);
    if (shorter.includes('/') && formatter(shorter)) return shorter;
  }
  return undefined;
}

/** The zone's offset from UTC at an instant, in milliseconds (east is positive). The zone must be resolved. */
export function offsetAt(instant: number, zone: string): number {
  if (zone === 'UTC') return 0;
  const f = formatter(zone);
  if (!f) throw new RangeError(`Unknown time zone: ${zone}`);
  const whole = Math.floor(instant / SECOND) * SECOND;
  const part: Record<string, number> = {};
  for (const { type, value } of f.formatToParts(whole)) part[type] = Number(value);
  const wall = Date.UTC(part.year ?? 0, (part.month ?? 1) - 1, part.day ?? 1, part.hour ?? 0, part.minute ?? 0, part.second ?? 0);
  return wall - whole;
}

/** The wall-clock reading of an instant in a zone. */
export function instantToWall(instant: number, zone: string): number {
  return instant + offsetAt(instant, zone);
}

/**
 * The instant of a wall-clock reading in a zone. Where the clocks go back and the reading happens twice, the first
 * (as RFC 5545 §3.3.5 says); where they go forward and it never happens, the reading is taken with the offset from
 * before the gap, so 02:30 on that night is 03:30.
 */
export function wallToInstant(wall: number, zone: string): number {
  if (zone === 'UTC') return wall;
  const before = offsetAt(wall - DAY, zone);
  const after = offsetAt(wall + DAY, zone);
  if (before === after) return wall - before;
  const early = wall - before;
  const late = wall - after;
  const earlyHolds = offsetAt(early, zone) === before;
  const lateHolds = offsetAt(late, zone) === after;
  if (earlyHolds && lateHolds) return Math.min(early, late);
  if (lateHolds) return late;
  return early;
}

/** A calendar date and time of day as a wall value. Months are 1-12. */
export function wall(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/** The instant a wall-clock reading in a zone stands for: `zoned(2026, 11, 24, 18, 0, 'Europe/Prague')`. */
export function zoned(year: number, month: number, day: number, hour: number, minute: number, zone: string): number {
  return wallToInstant(wall(year, month, day, hour, minute), zone);
}
