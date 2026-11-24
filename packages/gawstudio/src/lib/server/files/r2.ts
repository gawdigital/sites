// Cloudflare R2 through its S3 API: presigned URLs for the browser (upload a part, download an object) and our own
// server-side calls (start, list, complete and abort a multipart upload; look at and delete an object).
//
// Facts checked against Cloudflare's documentation on 2026-11-24:
// - https://developers.cloudflare.com/r2/api/s3/api/
//   CreateMultipartUpload, UploadPart, ListParts (with `max-parts` and `part-number-marker`),
//   CompleteMultipartUpload, AbortMultipartUpload, HeadObject, GetObject and DeleteObject are all implemented.
//   CreateMultipartUpload stores `Content-Type` and `Content-Disposition`. The region is `auto` (`us-east-1` and
//   an empty region are aliases). Uploading a part number again replaces that part.
// - https://developers.cloudflare.com/r2/api/s3/presigned-urls/
//   GET, HEAD, PUT and DELETE can be presigned (an HTML form POST cannot); a URL is valid from 1 second to 7 days
//   (604,800 s); presigned URLs work only on the S3 API domain `<account>.r2.cloudflarestorage.com`, never on a
//   custom domain; the bucket needs CORS rules for a browser to use them.
// - https://developers.cloudflare.com/r2/objects/multipart-objects/
//   A part is at least 5 MiB except the last, at most 5 GiB; at most 10,000 parts; all parts but the last have the
//   same size; a part's ETag is the MD5 of its content; an upload left incomplete is aborted after 7 days by the
//   bucket's default lifecycle rule.
// - https://developers.cloudflare.com/r2/platform/limits/
//   An object is at most 5 TiB less 5 GiB; one request (so one part) at most 5 GiB less 5 MiB, the stricter of
//   the two part limits and the one used here; 10,000 parts; a key at most 1,024 bytes; metadata 8,192 bytes.
// - https://developers.cloudflare.com/r2/reference/data-location/
//   A bucket in a jurisdiction (`eu`) is reached at `<account>.<jurisdiction>.r2.cloudflarestorage.com`; the
//   jurisdiction cannot be changed after the bucket is created.
//
// UNVERIFIED (none of those pages says so; each is standard S3 behaviour):
// - that GetObject honours `response-content-disposition`. Because of that, the name is ALSO stored on the object
//   as `Content-Disposition` when the upload starts (verified above), so a download gets its original name either
//   way.
// - that custom metadata (`x-amz-meta-*`) is accepted by CreateMultipartUpload and returned by HeadObject. The
//   original name is kept in the upload record too (see `plan.ts`), so nothing depends on it.
// - that path-style addressing (`/<bucket>/<key>`) is accepted in production; the presigned-URL page shows
//   virtual-hosted URLs from the SDKs and names path-style only for local development.
// - that a bare subresource may be sent as `?uploads=` (what the AWS SDKs send).
// - that the bucket's CORS rules must expose the `ETag` response header for the browser to read each part's ETag
//   (required with S3). If it cannot, the server can still take the ETags from ListParts before completing.
//
// The Workers R2 binding instead of the S3 API: the binding (checked in `@cloudflare/workers-types`, `R2Bucket` and
// `R2MultipartUpload`) can create, resume, complete and abort a multipart upload and head and delete an object
// without any credentials, but it cannot presign and it has no ListParts. Presigning therefore always needs S3
// credentials; the server-side calls go through the `FileStore` interface below, so a binding-backed
// implementation can replace `s3Store` (it would have to answer `listParts` from part numbers and ETags the
// browser reports, kept by the caller).
import { contentDisposition } from './names.ts';
import { encodePath, presign, signHeaders, type SignableRequest, type SigningContext } from './sigv4.ts';

/** Where the files live and who we are there. All of it comes from Cloudflare secrets and config. */
export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Set for a bucket created in a jurisdiction, e.g. `eu`. */
  jurisdiction?: string;
}

/** The part of `fetch` this module uses, so a test or a caller can hand in its own. */
export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response>;

export const MIN_PRESIGN_SECONDS = 1;
export const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;
export const MAX_PARTS = 10_000;
/** ListParts returns at most this many parts per call. */
const LIST_PAGE = 1000;

export interface UploadedPart {
  partNumber: number;
  /** As R2 returned it, quotes included. */
  etag: string;
  size?: number;
}

export interface StoredObject {
  size: number;
  etag: string;
  contentType?: string;
  lastModified?: Date;
  /** Custom metadata (`x-amz-meta-*`), names without the prefix. */
  metadata: Record<string, string>;
}

export interface CreateOptions {
  contentType?: string;
  /** Stored as the object's `Content-Disposition` and, percent-encoded, as the metadata `original-name`. */
  originalName?: string;
}

/** The server-side calls, behind an interface so the Workers R2 binding can stand in for the S3 API. */
export interface FileStore {
  /** Starts a multipart upload and returns its upload id. */
  createMultipartUpload(key: string, options?: CreateOptions): Promise<string>;
  /** The parts R2 already holds, in ascending order: what a resumed upload can skip. */
  listParts(key: string, uploadId: string): Promise<UploadedPart[]>;
  /** Assembles the object from the parts and returns its ETag. */
  completeMultipartUpload(key: string, uploadId: string, parts: readonly UploadedPart[]): Promise<string>;
  /** Drops the upload and its parts. An upload that no longer exists is not an error. */
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  /** The object's size and metadata, or `undefined` when there is no such object. */
  headObject(key: string): Promise<StoredObject | undefined>;
  /** Deletes the object. Deleting one that does not exist succeeds, as in S3. */
  deleteObject(key: string): Promise<void>;
}

/** An error R2 answered with: the HTTP status and the `Code` and `Message` of its XML error document. */
export class R2Error extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(`R2 ${status} ${code}: ${message}`);
    this.name = 'R2Error';
    this.status = status;
    this.code = code;
  }
}

export function r2Host(config: R2Config): string {
  return `${config.accountId}${config.jurisdiction ? `.${config.jurisdiction}` : ''}.r2.cloudflarestorage.com`;
}

function context(config: R2Config, now: Date): SigningContext {
  const { accessKeyId, secretAccessKey } = config;
  return { credentials: { accessKeyId, secretAccessKey }, region: 'auto', service: 's3', now };
}

function objectRequest(config: R2Config, method: string, key: string): SignableRequest {
  if (!key || key.startsWith('/')) throw new RangeError('An object key is not empty and does not start with a slash');
  return { method, host: r2Host(config), path: encodePath(`/${config.bucket}/${key}`) };
}

function checkExpiry(expiresIn: number): void {
  if (!Number.isInteger(expiresIn) || expiresIn < MIN_PRESIGN_SECONDS || expiresIn > MAX_PRESIGN_SECONDS)
    throw new RangeError(`A presigned URL is valid for ${MIN_PRESIGN_SECONDS} to ${MAX_PRESIGN_SECONDS} seconds`);
}

function checkPartNumber(partNumber: number): void {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS)
    throw new RangeError(`A part number is a whole number from 1 to ${MAX_PARTS}`);
}

export interface PresignUploadPart {
  key: string;
  uploadId: string;
  partNumber: number;
  /** Seconds the URL stays valid, counted from `now`. */
  expiresIn: number;
  now: Date;
}

/**
 * A URL the browser can `PUT` one part's bytes to. Nothing but the host is signed, so the browser sends the body
 * and no special headers; R2 answers with the part's `ETag`, which completing the upload needs.
 */
export async function presignUploadPart(config: R2Config, part: PresignUploadPart): Promise<string> {
  checkExpiry(part.expiresIn);
  checkPartNumber(part.partNumber);
  const request = objectRequest(config, 'PUT', part.key);
  const query = [['partNumber', String(part.partNumber)], ['uploadId', part.uploadId]] as const;
  return presign({ ...request, query }, context(config, part.now), part.expiresIn);
}

export interface PresignDownload {
  key: string;
  /** The name the browser saves the file under; without it the object's stored `Content-Disposition` applies. */
  originalName?: string;
  expiresIn: number;
  now: Date;
}

/** A URL that downloads the object, made on each click and short-lived, so the bucket stays private. */
export async function presignDownload(config: R2Config, download: PresignDownload): Promise<string> {
  checkExpiry(download.expiresIn);
  const request = objectRequest(config, 'GET', download.key);
  const query: (readonly [string, string])[] = download.originalName
    ? [['response-content-disposition', contentDisposition(download.originalName)]]
    : [];
  return presign({ ...request, query }, context(config, download.now), download.expiresIn);
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function unescapeXml(s: string): string {
  return s.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(\w+));/g, (whole, dec?: string, hexa?: string, name?: string) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hexa) return String.fromCodePoint(parseInt(hexa, 16));
    return (name && ENTITIES[name]) ?? whole;
  });
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&${Object.keys(ENTITIES).find((k) => ENTITIES[k] === c)};`);
}

/** The text of the first `<name>` element, or `undefined`. Enough for S3's flat answers; not an XML parser. */
export function xmlText(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m?.[1] === undefined ? undefined : unescapeXml(m[1]);
}

/** The error in an S3 error document, or `undefined` when the text is not one. */
export function parseError(xml: string, status: number): R2Error | undefined {
  if (!/<Error[\s>]/.test(xml)) return undefined;
  return new R2Error(status, xmlText(xml, 'Code') ?? 'Unknown', xmlText(xml, 'Message') ?? '');
}

export function parseUploadId(xml: string): string | undefined {
  return xmlText(xml, 'UploadId') || undefined;
}

export interface PartsPage {
  parts: UploadedPart[];
  /** Set when there are more parts: the `part-number-marker` of the next call. */
  next?: string;
}

export function parseListParts(xml: string): PartsPage {
  const parts: UploadedPart[] = [];
  for (const [, part = ''] of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
    const partNumber = Number(xmlText(part, 'PartNumber'));
    const etag = xmlText(part, 'ETag');
    const size = Number(xmlText(part, 'Size'));
    if (Number.isInteger(partNumber) && etag) parts.push({ partNumber, etag, ...(Number.isFinite(size) && { size }) });
  }
  const truncated = xmlText(xml, 'IsTruncated') === 'true';
  const next = xmlText(xml, 'NextPartNumberMarker');
  return { parts, ...(truncated && next && { next }) };
}

/** The body of CompleteMultipartUpload: every part's number and ETag, in ascending order as S3 requires. */
export function completeBody(parts: readonly UploadedPart[]): string {
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  const items = sorted.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXml(p.etag)}</ETag></Part>`);
  return `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUpload>${items.join('')}</CompleteMultipartUpload>`;
}

/**
 * The server-side calls over R2's S3 API, each signed in its headers. `now` is asked for every request, since a
 * signature is only accepted near the time it names.
 */
export function s3Store(config: R2Config, fetch: Fetch, now: () => Date): FileStore {
  async function call(request: SignableRequest, body?: string): Promise<Response> {
    const signed = await signHeaders(request, context(config, now()), body ?? '');
    return fetch(signed.url, { method: signed.method, headers: signed.headers, ...(body !== undefined && { body }) });
  }

  async function failure(response: Response): Promise<R2Error> {
    const text = await response.text().catch(() => '');
    return parseError(text, response.status) ?? new R2Error(response.status, 'Unknown', response.statusText);
  }

  return {
    async createMultipartUpload(key, options = {}) {
      const headers: Record<string, string> = {};
      if (options.contentType) headers['content-type'] = options.contentType;
      if (options.originalName) {
        headers['content-disposition'] = contentDisposition(options.originalName);
        headers['x-amz-meta-original-name'] = encodeURIComponent(options.originalName);
      }
      const response = await call({ ...objectRequest(config, 'POST', key), query: [['uploads', '']], headers });
      if (!response.ok) throw await failure(response);
      const uploadId = parseUploadId(await response.text());
      if (!uploadId) throw new R2Error(response.status, 'NoUploadId', 'The answer carried no upload id');
      return uploadId;
    },

    async listParts(key, uploadId) {
      const parts: UploadedPart[] = [];
      let marker: string | undefined;
      // 10,000 parts at 1,000 a page is ten calls; the bound only guards against an answer that never ends.
      for (let page = 0; page <= MAX_PARTS / LIST_PAGE; page++) {
        const query: (readonly [string, string])[] = [['max-parts', String(LIST_PAGE)], ['uploadId', uploadId]];
        if (marker) query.push(['part-number-marker', marker]);
        const response = await call({ ...objectRequest(config, 'GET', key), query });
        if (!response.ok) throw await failure(response);
        const { parts: more, next } = parseListParts(await response.text());
        parts.push(...more);
        if (!next) break;
        marker = next;
      }
      return parts.sort((a, b) => a.partNumber - b.partNumber);
    },

    async completeMultipartUpload(key, uploadId, parts) {
      const body = completeBody(parts);
      const request = { ...objectRequest(config, 'POST', key), query: [['uploadId', uploadId]] as const };
      const response = await call({ ...request, headers: { 'content-type': 'application/xml' } }, body);
      if (!response.ok) throw await failure(response);
      // S3 can answer 200 and still carry an error document, when assembling fails after the headers went out.
      const text = await response.text();
      const error = parseError(text, response.status);
      if (error) throw error;
      return xmlText(text, 'ETag') ?? '';
    },

    async abortMultipartUpload(key, uploadId) {
      const response = await call({ ...objectRequest(config, 'DELETE', key), query: [['uploadId', uploadId]] });
      if (response.ok) return;
      const error = await failure(response);
      if (error.status !== 404) throw error;
    },

    async headObject(key) {
      const response = await call(objectRequest(config, 'HEAD', key));
      if (response.status === 404) return undefined;
      if (!response.ok) throw await failure(response);
      const metadata: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        if (name.toLowerCase().startsWith('x-amz-meta-')) metadata[name.slice('x-amz-meta-'.length).toLowerCase()] = value;
      });
      const contentType = response.headers.get('content-type');
      const lastModified = response.headers.get('last-modified');
      return {
        size: Number(response.headers.get('content-length') ?? 0),
        etag: response.headers.get('etag') ?? '',
        ...(contentType && { contentType }),
        ...(lastModified && { lastModified: new Date(lastModified) }),
        metadata,
      };
    },

    async deleteObject(key) {
      const response = await call(objectRequest(config, 'DELETE', key));
      if (!response.ok && response.status !== 404) throw await failure(response);
    },
  };
}
