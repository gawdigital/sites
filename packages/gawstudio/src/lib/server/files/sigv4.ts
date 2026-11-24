// AWS Signature Version 4, the part of it the S3 API of Cloudflare R2 needs: signing a request in its headers
// (our own server-side calls) and in its query string (a presigned URL the browser uses). WebCrypto only, so it runs
// in a Worker and under Bun; no SDK. Checked in `sigv4.test.ts` against the worked examples AWS publishes for S3
// (docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html and sigv4-header-based-auth.html).

const encoder = new TextEncoder();

export const ALGORITHM = 'AWS4-HMAC-SHA256';
/** The payload hash of a presigned URL: the body is not known when the URL is made. */
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

/** What a signature is bound to besides the request: the credentials, where they apply and the moment. */
export interface SigningContext {
  credentials: Credentials;
  region: string;
  service: string;
  now: Date;
}

/**
 * A request as SigV4 sees it. `path` is already percent-encoded (see `encodePath`); `query` and `headers` are raw.
 * `host` is signed as given, so it carries the port when that is not the scheme's default.
 */
export interface SignableRequest {
  method: string;
  host: string;
  path: string;
  query?: readonly (readonly [string, string])[];
  headers?: Readonly<Record<string, string>>;
}

export const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, encoder.encode(data));
}

/** RFC 3986 encoding as SigV4 wants it: everything but the unreserved characters, upper-case hex. */
export function encodeRfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** An object path, each segment encoded once and the slashes kept (S3 does not double-encode the path). */
export function encodePath(path: string): string {
  return path.split('/').map(encodeRfc3986).join('/');
}

/** `20130524T000000Z`: the basic ISO 8601 form SigV4 uses; its first eight characters are the scope's date. */
export function amzDate(now: Date): string {
  return now.toISOString().replace(/[-:]|\.\d{3}/g, '');
}

export function credentialScope(ctx: SigningContext): string {
  return `${amzDate(ctx.now).slice(0, 8)}/${ctx.region}/${ctx.service}/aws4_request`;
}

/** The query string in canonical form: both sides encoded, sorted by name and then by value. */
export function canonicalQuery(query: readonly (readonly [string, string])[] = []): string {
  return query
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak === bk ? cmp(av, bv) : cmp(ak, bk)))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Header names lower-cased and sorted, values trimmed with inner runs of spaces collapsed. */
function canonicalHeaders(headers: Readonly<Record<string, string>>): { block: string; signed: string } {
  const entries = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => cmp(a, b));
  return {
    block: entries.map(([k, v]) => `${k}:${v}\n`).join(''),
    signed: entries.map(([k]) => k).join(';'),
  };
}

/** The canonical request; the `host` header is added from `request.host` unless the headers carry one. */
export function canonicalRequest(request: SignableRequest, payloadHash: string): string {
  const { block, signed } = canonicalHeaders(withHost(request));
  return [request.method.toUpperCase(), request.path, canonicalQuery(request.query), block, signed, payloadHash].join('\n');
}

function withHost(request: SignableRequest): Record<string, string> {
  const headers: Record<string, string> = { ...request.headers };
  if (!Object.keys(headers).some((k) => k.toLowerCase() === 'host')) headers.host = request.host;
  return headers;
}

export async function stringToSign(canonical: string, ctx: SigningContext): Promise<string> {
  return [ALGORITHM, amzDate(ctx.now), credentialScope(ctx), await sha256Hex(canonical)].join('\n');
}

/** The signature of a string to sign, with the key derived from the secret, the date, the region and the service. */
export async function signature(toSign: string, ctx: SigningContext): Promise<string> {
  const date = amzDate(ctx.now).slice(0, 8);
  let key = await hmac(encoder.encode(`AWS4${ctx.credentials.secretAccessKey}`), date);
  for (const part of [ctx.region, ctx.service, 'aws4_request']) key = await hmac(key, part);
  return hex(await hmac(key, toSign));
}

/**
 * A presigned URL: the signature travels in the query string, so whoever holds the URL can make exactly this
 * request until it expires. Only `host` is signed unless `request.headers` names more, which the caller of the URL
 * must then send unchanged.
 */
export async function presign(request: SignableRequest, ctx: SigningContext, expiresIn: number): Promise<string> {
  const { signed } = canonicalHeaders(withHost(request));
  const query: (readonly [string, string])[] = [
    ...(request.query ?? []),
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', `${ctx.credentials.accessKeyId}/${credentialScope(ctx)}`],
    ['X-Amz-Date', amzDate(ctx.now)],
    ['X-Amz-Expires', String(expiresIn)],
    ['X-Amz-SignedHeaders', signed],
  ];
  const canonical = canonicalRequest({ ...request, query }, UNSIGNED_PAYLOAD);
  const sig = await signature(await stringToSign(canonical, ctx), ctx);
  return `https://${request.host}${request.path}?${canonicalQuery(query)}&X-Amz-Signature=${sig}`;
}

/** A request signed in its headers, ready for `fetch`. */
export interface SignedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/**
 * Signs a request in its `Authorization` header. `x-amz-date` and `x-amz-content-sha256` are added and signed along
 * with every header given; `host` is signed but left for `fetch` to send.
 */
export async function signHeaders(request: SignableRequest, ctx: SigningContext, body: string | Uint8Array = ''): Promise<SignedRequest> {
  const payloadHash = await sha256Hex(body);
  const headers = { ...request.headers, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate(ctx.now) };
  const signable = { ...request, headers };
  const sig = await signature(await stringToSign(canonicalRequest(signable, payloadHash), ctx), ctx);
  const { signed } = canonicalHeaders(withHost(signable));
  const query = canonicalQuery(request.query);
  return {
    url: `https://${request.host}${request.path}${query ? `?${query}` : ''}`,
    method: request.method.toUpperCase(),
    headers: {
      ...headers,
      authorization: `${ALGORITHM} Credential=${ctx.credentials.accessKeyId}/${credentialScope(ctx)}, SignedHeaders=${signed}, Signature=${sig}`,
    },
  };
}
