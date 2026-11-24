// Retention: sources and results are kept for a number of days after delivery (a setting, 30 by default) and then
// deleted. The customer is told a date, so the rule is made of calendar days in the studio's time zone:
//
//   last day   = the local date of delivery + `retentionDays`
//   expiresAt  = the end of the last day (local midnight), from when the files may be deleted
//   reminderAt = `reminderHour` local time, `reminderDays` before the last day
//
// Who deletes. A bucket lifecycle rule cannot do it alone: R2's rules count an object's age from its upload and
// apply per prefix (https://developers.cloudflare.com/r2/buckets/object-lifecycles/, read 2026-11-24: prefix and
// age or date conditions, delete and abort-multipart actions, at most 1,000 rules, objects removed "typically
// within 24 hours" of expiry). Delivery comes days or weeks after the sources were uploaded and differs per order,
// and a rule per order would run into the rule maximum. So:
//
// - the application deletes each order's files once `expiresAt` has passed (a scheduled job that takes
//   `deletionPlan` and calls `deleteObject` and `abortMultipartUpload`), which is what keeps the stated date;
// - the bucket carries two rules as a backstop, so nothing outlives a bug or an abandoned order:
//     1. prefix `orders/`: delete objects N days after upload, N well above the longest order plus the retention
//        (for example 180; it must never be shorter than an order can take, or sources vanish mid-order);
//     2. abort incomplete multipart uploads 7 days after they started (R2's default rule; keep it).
//   UNVERIFIED: that the age of a multipart object counts from its completion rather than its start.
import { kindPrefix, orderPrefix, type UploadRecord } from './plan.ts';
import type { FileSettings } from './settings.ts';

type RetentionSettings = Pick<FileSettings, 'retentionDays' | 'reminderDays' | 'reminderHour' | 'timeZone'>;

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

/** The wall-clock fields of an instant in a time zone, as if they were UTC: the zone's offset is the difference. */
function wallClock(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
}

function localDate(at: Date, timeZone: string): LocalDate {
  const wall = new Date(wallClock(at, timeZone));
  return { year: wall.getUTCFullYear(), month: wall.getUTCMonth() + 1, day: wall.getUTCDate() };
}

/** Calendar arithmetic: months and years roll over, and no clock is involved, so no daylight saving either. */
function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** The instant a local date and hour name in a time zone. The offset is looked up twice, for days it changes. */
function instant(date: LocalDate, hour: number, timeZone: string): Date {
  const wall = Date.UTC(date.year, date.month - 1, date.day, hour);
  let at = wall;
  for (let i = 0; i < 2; i++) at = wall - (wallClock(new Date(at), timeZone) - at);
  return new Date(at);
}

const iso = ({ year, month, day }: LocalDate): string =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

function lastLocalDay(deliveredAt: Date, settings: RetentionSettings): LocalDate {
  return addDays(localDate(deliveredAt, settings.timeZone), settings.retentionDays);
}

/** The last day the files can be downloaded, `YYYY-MM-DD` in the settings' time zone: the date to show and mail. */
export function lastDay(deliveredAt: Date, settings: RetentionSettings): string {
  return iso(lastLocalDay(deliveredAt, settings));
}

/** The instant the last day ends: from then on the order's files are deleted. */
export function expiresAt(deliveredAt: Date, settings: RetentionSettings): Date {
  return instant(addDays(lastLocalDay(deliveredAt, settings), 1), 0, settings.timeZone);
}

/**
 * When the reminder is due, or `undefined` when that moment is not after the delivery (a retention as short as the
 * reminder's lead: the delivery e-mail has just stated the date).
 */
export function reminderAt(deliveredAt: Date, settings: RetentionSettings): Date | undefined {
  const day = addDays(lastLocalDay(deliveredAt, settings), -settings.reminderDays);
  const at = instant(day, settings.reminderHour, settings.timeZone);
  return at.getTime() > deliveredAt.getTime() ? at : undefined;
}

/** Whether an order's files are due for deletion. */
export function isExpired(deliveredAt: Date, settings: RetentionSettings, now: Date): boolean {
  return now.getTime() >= expiresAt(deliveredAt, settings).getTime();
}

export interface DeletionPlan {
  /** Everything of the order lives under these; after the plan has run they hold nothing. */
  prefixes: string[];
  /** Completed uploads: objects to delete. */
  objects: string[];
  /** Uploads never finished: to abort, which drops their parts. */
  uploads: { key: string; uploadId: string }[];
}

/**
 * What to delete when an order's retention ends, from its upload records: no listing of the bucket is needed,
 * since every object was created through a record. Aborted uploads have nothing left.
 */
export function deletionPlan(orderId: string, records: readonly Pick<UploadRecord, 'orderId' | 'state' | 'key' | 'uploadId'>[]): DeletionPlan {
  const own = records.filter((r) => r.orderId === orderId && r.key.startsWith(orderPrefix(orderId)));
  return {
    prefixes: [kindPrefix(orderId, 'sources'), kindPrefix(orderId, 'results')],
    objects: own.filter((r) => r.state === 'completed').map((r) => r.key),
    uploads: own.filter((r) => r.state === 'initiated' || r.state === 'uploading').map(({ key, uploadId }) => ({ key, uploadId })),
  };
}
