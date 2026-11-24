// Planning an upload, as pure functions: where a file goes in the bucket, whether it may be uploaded at all, how it
// is cut into parts, which parts a resumed upload still owes, and the record of an upload the caller persists.
import { extensionOf, cleanOriginalName, sanitiseFileName } from './names.ts';
import { MAX_PARTS, type UploadedPart } from './r2.ts';
import { GiB, MiB, TiB, type FileSettings } from './settings.ts';

/** R2's limits (sources and date in `r2.ts`). The part maximum is the stricter per-request figure. */
export const MIN_PART_BYTES = 5 * MiB;
export const MAX_PART_BYTES = 5 * GiB - 5 * MiB;
export const MAX_OBJECT_BYTES = 5 * TiB - 5 * GiB;

/** What the customer sent us, or what we send back. */
export type FileKind = 'sources' | 'results';

export interface FileRef {
  orderId: string;
  kind: FileKind;
  trackId: string;
  fileId: string;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function checkId(name: string, value: string): string {
  if (!ID.test(value)) throw new RangeError(`${name} is 1 to 64 characters of A-Z, a-z, 0-9, _ and -`);
  return value;
}

/** `orders/<orderId>/`: everything of one order, which is also what the technician hands to rclone. */
export function orderPrefix(orderId: string): string {
  return `orders/${checkId('orderId', orderId)}/`;
}

/** `orders/<orderId>/<sources|results>/`. */
export function kindPrefix(orderId: string, kind: FileKind): string {
  return `${orderPrefix(orderId)}${kind}/`;
}

/**
 * `orders/<orderId>/<sources|results>/<trackId>/<fileId>/<sanitised name>`. The file id makes the key unique, so
 * two files of the same name never overwrite each other and the name stays readable in a listing. The ids are ours;
 * one that could break out of its segment is a programming error and throws.
 */
export function objectKey(ref: FileRef, fileName: string): string {
  const { trackId, fileId } = ref;
  return `${kindPrefix(ref.orderId, ref.kind)}${checkId('trackId', trackId)}/${checkId('fileId', fileId)}/${sanitiseFileName(fileName)}`;
}

/** What the browser tells us about a file before it uploads it. */
export interface Candidate {
  name: string;
  size: number;
  /** The MIME type the browser reports; often empty. */
  type?: string;
}

export type Rejection = 'name' | 'empty' | 'extension' | 'type' | 'file-too-large' | 'order-too-large';
export type Validation = { ok: true } | { ok: false; reason: Rejection };

function typeAllowed(type: string, allowed: readonly string[]): boolean {
  const t = (type.split(';')[0] ?? '').trim().toLowerCase();
  // No type reported, or no list configured: the extension has already decided.
  if (!t || allowed.length === 0) return true;
  return allowed.some((a) => (a.endsWith('/*') ? t.startsWith(a.slice(0, -1)) : t === a.toLowerCase()));
}

/**
 * Whether a file may be uploaded to an order that already holds `orderBytes` (completed and running uploads,
 * sources and results together). The first failing rule is the reason.
 */
export function validateUpload(file: Candidate, settings: FileSettings, orderBytes = 0): Validation {
  const no = (reason: Rejection): Validation => ({ ok: false, reason });
  if (!cleanOriginalName(file.name)) return no('name');
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return no('empty');
  if (!settings.allowedExtensions.includes(extensionOf(file.name))) return no('extension');
  if (!typeAllowed(file.type ?? '', settings.allowedMimeTypes)) return no('type');
  if (file.size > Math.min(settings.maxFileBytes, MAX_OBJECT_BYTES)) return no('file-too-large');
  if (orderBytes + file.size > settings.maxOrderBytes) return no('order-too-large');
  return { ok: true };
}

export interface PartPlan {
  size: number;
  /** Every part has this size but the last, which has what remains. */
  partSize: number;
  partCount: number;
}

/**
 * How a file is cut into parts: the preferred size, kept within R2's limits and raised (to a whole number of MiB)
 * when the file would otherwise need more than 10,000 parts. A file smaller than one part is a single part.
 */
export function planParts(size: number, preferredPartBytes: number): PartPlan {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_OBJECT_BYTES)
    throw new RangeError(`A file has 1 to ${MAX_OBJECT_BYTES} bytes`);
  const preferred = Number.isFinite(preferredPartBytes) ? Math.floor(preferredPartBytes) : MIN_PART_BYTES;
  let partSize = Math.min(Math.max(preferred, MIN_PART_BYTES), MAX_PART_BYTES);
  if (Math.ceil(size / partSize) > MAX_PARTS) partSize = Math.ceil(size / MAX_PARTS / MiB) * MiB;
  return { size, partSize, partCount: Math.ceil(size / partSize) };
}

/** The bytes of part `partNumber` (from 1): what the browser slices out of the file. */
export function partRange(plan: PartPlan, partNumber: number): { offset: number; length: number } {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > plan.partCount)
    throw new RangeError(`This upload has parts 1 to ${plan.partCount}`);
  const offset = (partNumber - 1) * plan.partSize;
  return { offset, length: Math.min(plan.partSize, plan.size - offset) };
}

export interface Progress {
  /** The parts R2 holds that fit the plan: what CompleteMultipartUpload is given once nothing is missing. */
  done: UploadedPart[];
  /** The part numbers still to upload, ascending. */
  missing: number[];
  uploadedBytes: number;
}

/**
 * Where a resumed upload stands, from ListParts. A listed part counts only when its number is in the plan and its
 * size, when reported, is the planned one: anything else is uploaded again, which replaces it.
 */
export function progress(plan: PartPlan, listed: readonly UploadedPart[]): Progress {
  const byNumber = new Map<number, UploadedPart>();
  for (const part of listed) {
    if (!Number.isInteger(part.partNumber) || part.partNumber < 1 || part.partNumber > plan.partCount) continue;
    if (part.size !== undefined && part.size !== partRange(plan, part.partNumber).length) continue;
    byNumber.set(part.partNumber, part);
  }
  const done: UploadedPart[] = [];
  const missing: number[] = [];
  let uploadedBytes = 0;
  for (let n = 1; n <= plan.partCount; n++) {
    const part = byNumber.get(n);
    if (!part) missing.push(n);
    else {
      done.push(part);
      uploadedBytes += partRange(plan, n).length;
    }
  }
  return { done, missing, uploadedBytes };
}

/** The part numbers a resumed upload still owes. */
export function missingParts(plan: PartPlan, listed: readonly UploadedPart[]): number[] {
  return progress(plan, listed).missing;
}

/**
 * An upload's life: `initiated` once R2 gave an upload id, `uploading` once a part is known to be there, then
 * `completed` (the object exists) or `aborted` (the parts are gone). The last two are final.
 */
export type UploadState = 'initiated' | 'uploading' | 'completed' | 'aborted';

/** One upload, as plain data the caller can persist as it is (dates as ISO strings). */
export interface UploadRecord extends FileRef, PartPlan {
  key: string;
  uploadId: string;
  /** The name the customer's file had, for display and for the download. */
  originalName: string;
  contentType: string;
  state: UploadState;
  createdAt: string;
  updatedAt: string;
  /** The object's ETag, once completed. */
  etag?: string;
}

/** The record of an upload R2 has just started. */
export function initiate(ref: FileRef, file: Candidate, uploadId: string, settings: FileSettings, now: Date): UploadRecord {
  const at = now.toISOString();
  return {
    orderId: ref.orderId,
    kind: ref.kind,
    trackId: ref.trackId,
    fileId: ref.fileId,
    ...planParts(file.size, settings.partBytes),
    key: objectKey(ref, file.name),
    uploadId,
    originalName: cleanOriginalName(file.name),
    contentType: (file.type ?? '').trim() || 'application/octet-stream',
    state: 'initiated',
    createdAt: at,
    updatedAt: at,
  };
}

export type UploadEvent = { type: 'part-uploaded' } | { type: 'completed'; etag: string } | { type: 'aborted' };

/**
 * The record after an event, or `undefined` when the event does not apply in the record's state (nothing follows
 * `completed` or `aborted`). The browser uploads to R2 directly, so the server may first hear of an upload when it
 * is asked to complete it: `completed` follows `initiated` as well as `uploading`.
 */
export function advance(record: UploadRecord, event: UploadEvent, now: Date): UploadRecord | undefined {
  if (record.state === 'completed' || record.state === 'aborted') return undefined;
  const updatedAt = now.toISOString();
  switch (event.type) {
    case 'part-uploaded':
      return { ...record, state: 'uploading', updatedAt };
    case 'completed':
      return { ...record, state: 'completed', etag: event.etag, updatedAt };
    case 'aborted':
      return { ...record, state: 'aborted', updatedAt };
  }
}

/** The bytes an order counts against its cap: every upload that is completed or still running. */
export function orderBytes(records: readonly Pick<UploadRecord, 'state' | 'size'>[]): number {
  return records.reduce((sum, r) => (r.state === 'aborted' ? sum : sum + r.size), 0);
}
