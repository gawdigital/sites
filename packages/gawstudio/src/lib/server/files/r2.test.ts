import { describe, expect, test } from 'bun:test';

import {
  completeBody,
  MAX_PRESIGN_SECONDS,
  parseError,
  parseListParts,
  parseUploadId,
  presignDownload,
  presignUploadPart,
  r2Host,
  R2Error,
  s3Store,
  unescapeXml,
  type Fetch,
  type R2Config,
} from './r2.ts';
import { canonicalRequest, sha256Hex, signature, stringToSign } from './sigv4.ts';

// Made-up values: no real account, bucket or key.
const config: R2Config = {
  accountId: '0123456789abcdef0123456789abcdef',
  bucket: 'studio-files-test',
  accessKeyId: 'TESTACCESSKEYID',
  secretAccessKey: 'test-secret-access-key',
};
const HOST = '0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com';
const now = new Date('2026-11-24T10:20:30Z');
const key = 'orders/o1/sources/t1/f1/Song 1.wav';
const PATH = '/studio-files-test/orders/o1/sources/t1/f1/Song%201.wav';
const ctx = {
  credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  region: 'auto',
  service: 's3',
  now,
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** A `fetch` that records what it was asked and answers from a queue. */
function fake(...answers: Response[]): { fetch: Fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, ...init });
    const answer = answers.shift();
    if (!answer) throw new Error('No answer left');
    return answer;
  };
  return { fetch, calls };
}

const xml = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'application/xml' } });
const store = (f: Fetch) => s3Store(config, f, () => now);

/** Recomputes the signature of a recorded call from scratch and compares it with the one sent. */
async function expectSigned(call: Call): Promise<void> {
  const url = new URL(call.url);
  const { authorization = '', ...headers } = call.headers;
  const signedHeaders = authorization.match(/SignedHeaders=([^,]+)/)?.[1];
  expect(signedHeaders).toBe(['host', ...Object.keys(headers)].sort().join(';'));
  expect(authorization).toStartWith('AWS4-HMAC-SHA256 Credential=TESTACCESSKEYID/20261124/auto/s3/aws4_request, ');
  expect(headers['x-amz-date']).toBe('20261124T102030Z');
  expect(headers['x-amz-content-sha256']).toBe(await sha256Hex(call.body ?? ''));
  const canonical = canonicalRequest(
    { method: call.method, host: url.host, path: url.pathname, query: [...url.searchParams.entries()], headers },
    headers['x-amz-content-sha256'] ?? '',
  );
  expect(authorization).toEndWith(`Signature=${await signature(await stringToSign(canonical, ctx), ctx)}`);
}

describe('the endpoint', () => {
  test('the account is the host; a jurisdiction is a label of it', () => {
    expect(r2Host(config)).toBe(HOST);
    expect(r2Host({ ...config, jurisdiction: 'eu' })).toBe('0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com');
  });
});

describe('presigned URLs', () => {
  test('a part upload is a PUT to the S3 domain, path-style, with the part and the upload in the query', async () => {
    const link = await presignUploadPart(config, { key, uploadId: 'up+load/id=', partNumber: 7, expiresIn: 3600, now });
    const url = new URL(link);
    expect(url.origin).toBe(`https://${HOST}`);
    expect(url.pathname).toBe(PATH);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      partNumber: '7',
      uploadId: 'up+load/id=',
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': 'TESTACCESSKEYID/20261124/auto/s3/aws4_request',
      'X-Amz-Date': '20261124T102030Z',
      'X-Amz-Expires': '3600',
      'X-Amz-SignedHeaders': 'host',
      'X-Amz-Signature': expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(link).toContain('uploadId=up%2Bload%2Fid%3D');
    expect(link).not.toContain(config.secretAccessKey);

    // The signature is the one a verifier computes from the URL: method PUT, unsigned payload, host only.
    const query = [...url.searchParams.entries()].filter(([k]) => k !== 'X-Amz-Signature');
    const canonical = canonicalRequest({ method: 'PUT', host: HOST, path: PATH, query }, 'UNSIGNED-PAYLOAD');
    expect(url.searchParams.get('X-Amz-Signature')).toBe(await signature(await stringToSign(canonical, ctx), ctx));
  });

  test('the same input gives the same URL; another part, another signature', async () => {
    const part = { key, uploadId: 'u', partNumber: 1, expiresIn: 60, now };
    expect(await presignUploadPart(config, part)).toBe(await presignUploadPart(config, part));
    expect(await presignUploadPart(config, { ...part, partNumber: 2 })).not.toBe(await presignUploadPart(config, part));
  });

  test('a download carries the original name as the response disposition', async () => {
    const link = await presignDownload(config, { key, originalName: 'Píseň č. 1 (mix).wav', expiresIn: 300, now });
    const url = new URL(link);
    expect(url.pathname).toBe(PATH);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('response-content-disposition')).toBe(
      `attachment; filename="Pisen-c.-1-mix.wav"; filename*=UTF-8''P%C3%ADse%C5%88%20%C4%8D.%201%20%28mix%29.wav`,
    );
    expect(url.searchParams.has('partNumber')).toBe(false);

    const query = [...url.searchParams.entries()].filter(([k]) => k !== 'X-Amz-Signature');
    const canonical = canonicalRequest({ method: 'GET', host: HOST, path: PATH, query }, 'UNSIGNED-PAYLOAD');
    expect(url.searchParams.get('X-Amz-Signature')).toBe(await signature(await stringToSign(canonical, ctx), ctx));
  });

  test('without a name the stored disposition applies', async () => {
    const url = new URL(await presignDownload(config, { key, expiresIn: 300, now }));
    expect(url.searchParams.has('response-content-disposition')).toBe(false);
  });

  test('the expiry is 1 second to 7 days, in whole seconds', async () => {
    const part = { key, uploadId: 'u', partNumber: 1, now };
    expect(MAX_PRESIGN_SECONDS).toBe(604_800);
    for (const expiresIn of [1, 604_800]) expect(await presignUploadPart(config, { ...part, expiresIn })).toContain(`X-Amz-Expires=${expiresIn}&`);
    for (const expiresIn of [0, -5, 1.5, 604_801, Number.NaN]) {
      await expect(presignUploadPart(config, { ...part, expiresIn })).rejects.toThrow(RangeError);
      await expect(presignDownload(config, { key, expiresIn, now })).rejects.toThrow(RangeError);
    }
  });

  test('a part number is 1 to 10,000, and a key is relative', async () => {
    const part = { key, uploadId: 'u', expiresIn: 60, now };
    for (const partNumber of [1, 10_000]) expect(await presignUploadPart(config, { ...part, partNumber })).toContain(`partNumber=${partNumber}&`);
    for (const partNumber of [0, 10_001, 1.5]) await expect(presignUploadPart(config, { ...part, partNumber })).rejects.toThrow(RangeError);
    for (const bad of ['', '/orders/x']) await expect(presignDownload(config, { key: bad, expiresIn: 60, now })).rejects.toThrow(RangeError);
  });
});

describe('XML', () => {
  test('the upload id of CreateMultipartUpload', () => {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Bucket>studio-files-test</Bucket><Key>orders/o1/a&amp;b.wav</Key><UploadId>AbC.dEf-123_xyz</UploadId>
</InitiateMultipartUploadResult>`;
    expect(parseUploadId(body)).toBe('AbC.dEf-123_xyz');
    expect(parseUploadId('<InitiateMultipartUploadResult/>')).toBeUndefined();
  });

  test('the parts of ListParts, and the marker when there are more', () => {
    const body = `<ListPartsResult><Bucket>b</Bucket><Key>k</Key><UploadId>u</UploadId>
<PartNumberMarker>0</PartNumberMarker><NextPartNumberMarker>2</NextPartNumberMarker><MaxParts>2</MaxParts><IsTruncated>true</IsTruncated>
<Part><PartNumber>1</PartNumber><LastModified>2026-11-24T10:00:00.000Z</LastModified><ETag>&quot;aaa&quot;</ETag><Size>33554432</Size></Part>
<Part><PartNumber>2</PartNumber><ETag>"bbb"</ETag><Size>1024</Size></Part>
</ListPartsResult>`;
    expect(parseListParts(body)).toEqual({
      parts: [
        { partNumber: 1, etag: '"aaa"', size: 33_554_432 },
        { partNumber: 2, etag: '"bbb"', size: 1024 },
      ],
      next: '2',
    });
    expect(parseListParts('<ListPartsResult><IsTruncated>false</IsTruncated><NextPartNumberMarker>0</NextPartNumberMarker></ListPartsResult>')).toEqual({ parts: [] });
  });

  test('an error document', () => {
    const error = parseError('<?xml version="1.0"?><Error><Code>NoSuchUpload</Code><Message>The upload &lt;x&gt; does not exist.</Message></Error>', 404);
    expect(error).toBeInstanceOf(R2Error);
    expect(error).toMatchObject({ status: 404, code: 'NoSuchUpload', message: 'R2 404 NoSuchUpload: The upload <x> does not exist.' });
    expect(parseError('<CompleteMultipartUploadResult><ETag>"x-2"</ETag></CompleteMultipartUploadResult>', 200)).toBeUndefined();
  });

  test('entities', () => {
    expect(unescapeXml('&lt;a&gt; &amp;amp; &quot;q&quot; &apos;s&apos; &#65;&#x42; &nope;')).toBe(`<a> &amp; "q" 's' AB &nope;`);
  });

  test('the body of CompleteMultipartUpload lists the parts in order, ETags escaped', () => {
    expect(completeBody([{ partNumber: 2, etag: '"bbb"' }, { partNumber: 1, etag: '"a&a"' }])).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUpload>' +
        '<Part><PartNumber>1</PartNumber><ETag>&quot;a&amp;a&quot;</ETag></Part>' +
        '<Part><PartNumber>2</PartNumber><ETag>&quot;bbb&quot;</ETag></Part>' +
        '</CompleteMultipartUpload>',
    );
  });
});

describe('the server-side calls', () => {
  test('CreateMultipartUpload posts ?uploads with the type, the disposition and the name', async () => {
    const { fetch, calls } = fake(xml('<InitiateMultipartUploadResult><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>'));
    expect(await store(fetch).createMultipartUpload(key, { contentType: 'audio/wav', originalName: 'Píseň 1.wav' })).toBe('upload-1');
    const [call] = calls;
    expect(call).toMatchObject({ method: 'POST', url: `https://${HOST}${PATH}?uploads=` });
    expect(call?.body).toBeUndefined();
    expect(call?.headers).toMatchObject({
      'content-type': 'audio/wav',
      'content-disposition': `attachment; filename="Pisen-1.wav"; filename*=UTF-8''P%C3%ADse%C5%88%201.wav`,
      'x-amz-meta-original-name': 'P%C3%ADse%C5%88%201.wav',
    });
    await expectSigned(call!);
  });

  test('CreateMultipartUpload without an upload id in the answer fails', async () => {
    const { fetch } = fake(xml('<InitiateMultipartUploadResult/>'));
    await expect(store(fetch).createMultipartUpload(key)).rejects.toMatchObject({ code: 'NoUploadId' });
  });

  test('ListParts follows the marker until the list ends', async () => {
    const page = (n: number, more: boolean) =>
      xml(`<ListPartsResult><IsTruncated>${more}</IsTruncated><NextPartNumberMarker>${n}</NextPartNumberMarker>
<Part><PartNumber>${n}</PartNumber><ETag>"e${n}"</ETag><Size>10</Size></Part></ListPartsResult>`);
    const { fetch, calls } = fake(page(1, true), page(2, false));
    expect(await store(fetch).listParts(key, 'upload-1')).toEqual([
      { partNumber: 1, etag: '"e1"', size: 10 },
      { partNumber: 2, etag: '"e2"', size: 10 },
    ]);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET https://${HOST}${PATH}?max-parts=1000&uploadId=upload-1`,
      `GET https://${HOST}${PATH}?max-parts=1000&part-number-marker=1&uploadId=upload-1`,
    ]);
    for (const call of calls) await expectSigned(call);
  });

  test('CompleteMultipartUpload posts the parts as XML and returns the ETag', async () => {
    const { fetch, calls } = fake(xml('<CompleteMultipartUploadResult><Key>k</Key><ETag>&quot;abc-2&quot;</ETag></CompleteMultipartUploadResult>'));
    const parts = [{ partNumber: 2, etag: '"bbb"' }, { partNumber: 1, etag: '"aaa"' }];
    expect(await store(fetch).completeMultipartUpload(key, 'upload-1', parts)).toBe('"abc-2"');
    const [call] = calls;
    expect(call).toMatchObject({ method: 'POST', url: `https://${HOST}${PATH}?uploadId=upload-1`, body: completeBody(parts) });
    expect(call?.headers['content-type']).toBe('application/xml');
    await expectSigned(call!);
  });

  test('CompleteMultipartUpload fails on an error document, even with status 200', async () => {
    const error = '<Error><Code>InvalidPart</Code><Message>Part 2 is missing.</Message></Error>';
    await expect(store(fake(xml(error)).fetch).completeMultipartUpload(key, 'u', [])).rejects.toMatchObject({ status: 200, code: 'InvalidPart' });
    await expect(store(fake(xml(error, 400)).fetch).completeMultipartUpload(key, 'u', [])).rejects.toMatchObject({ status: 400, code: 'InvalidPart' });
  });

  test('AbortMultipartUpload deletes the upload; one already gone is fine', async () => {
    const { fetch, calls } = fake(new Response(null, { status: 204 }), xml('<Error><Code>NoSuchUpload</Code><Message>Gone.</Message></Error>', 404));
    await store(fetch).abortMultipartUpload(key, 'upload-1');
    await store(fetch).abortMultipartUpload(key, 'upload-1');
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: `https://${HOST}${PATH}?uploadId=upload-1` });
    await expectSigned(calls[0]!);
    const denied = fake(xml('<Error><Code>AccessDenied</Code><Message>No.</Message></Error>', 403));
    await expect(store(denied.fetch).abortMultipartUpload(key, 'upload-1')).rejects.toMatchObject({ status: 403, code: 'AccessDenied' });
  });

  test('HeadObject reads the size and the metadata; a missing object is undefined', async () => {
    const headers = {
      'content-length': '123456',
      'content-type': 'audio/wav',
      etag: '"abc-2"',
      'last-modified': 'Tue, 24 Nov 2026 10:00:00 GMT',
      'x-amz-meta-original-name': 'P%C3%ADse%C5%88%201.wav',
    };
    const { fetch, calls } = fake(new Response(null, { status: 200, headers }), new Response(null, { status: 404 }));
    expect(await store(fetch).headObject(key)).toEqual({
      size: 123_456,
      etag: '"abc-2"',
      contentType: 'audio/wav',
      lastModified: new Date('2026-11-24T10:00:00Z'),
      metadata: { 'original-name': 'P%C3%ADse%C5%88%201.wav' },
    });
    expect(await store(fetch).headObject(key)).toBeUndefined();
    expect(calls[0]).toMatchObject({ method: 'HEAD', url: `https://${HOST}${PATH}` });
    await expectSigned(calls[0]!);
    await expect(store(fake(new Response(null, { status: 403, statusText: 'Forbidden' })).fetch).headObject(key)).rejects.toMatchObject({ status: 403 });
  });

  test('DeleteObject', async () => {
    const { fetch, calls } = fake(new Response(null, { status: 204 }));
    await store(fetch).deleteObject(key);
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: `https://${HOST}${PATH}` });
    expect(calls[0]?.body).toBeUndefined();
    await expectSigned(calls[0]!);
    const failed = fake(xml('<Error><Code>InternalError</Code><Message>Try again.</Message></Error>', 500));
    await expect(store(failed.fetch).deleteObject(key)).rejects.toBeInstanceOf(R2Error);
  });

  test('each request is signed at the time it is made', async () => {
    const { fetch, calls } = fake(new Response(null, { status: 204 }), new Response(null, { status: 204 }));
    const times = [new Date('2026-11-24T10:00:00Z'), new Date('2026-11-25T11:00:00Z')];
    const s = s3Store(config, fetch, () => times.shift()!);
    await s.deleteObject(key);
    await s.deleteObject(key);
    expect(calls.map((c) => c.headers['x-amz-date'])).toEqual(['20261124T100000Z', '20261125T110000Z']);
  });
});
