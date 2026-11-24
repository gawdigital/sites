import { describe, expect, test } from 'bun:test';

import {
  amzDate,
  canonicalQuery,
  canonicalRequest,
  encodePath,
  encodeRfc3986,
  presign,
  sha256Hex,
  signHeaders,
  stringToSign,
  UNSIGNED_PAYLOAD,
  type SignableRequest,
  type SigningContext,
} from './sigv4.ts';

// The example credentials and requests of AWS's own S3 SigV4 documentation, not a real account:
// docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html and .../sigv4-header-based-auth.html
const ctx: SigningContext = {
  credentials: { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
  region: 'us-east-1',
  service: 's3',
  now: new Date('2013-05-24T00:00:00Z'),
};
const host = 'examplebucket.s3.amazonaws.com';
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const signatureOf = (authorization: string | undefined) => authorization?.match(/Signature=([0-9a-f]{64})$/)?.[1];

describe('the pieces', () => {
  test('the date has the basic ISO form', () => {
    expect(amzDate(new Date('2026-11-24T09:08:07.654Z'))).toBe('20261124T090807Z');
  });

  test('only unreserved characters stay unencoded', () => {
    expect(encodeRfc3986("a-b_c.d~e f/g*h'i(j)k!l+m=n")).toBe('a-b_c.d~e%20f%2Fg%2Ah%27i%28j%29k%21l%2Bm%3Dn');
    expect(encodeRfc3986('ž')).toBe('%C5%BE');
    expect(encodePath('/bucket/a b/c$d.wav')).toBe('/bucket/a%20b/c%24d.wav');
  });

  test('the query is sorted by name, then by value, and a bare name gets an equals sign', () => {
    expect(canonicalQuery([['uploads', '']])).toBe('uploads=');
    expect(canonicalQuery([['b', '2'], ['a', 'z'], ['a', 'y'], ['A', '1']])).toBe('A=1&a=y&a=z&b=2');
  });

  test('the empty hash', async () => {
    expect(await sha256Hex('')).toBe(EMPTY);
  });
});

describe('presigning, against the AWS example', () => {
  const request: SignableRequest = { method: 'GET', host, path: '/test.txt' };
  const query = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', 'AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request'],
    ['X-Amz-Date', '20130524T000000Z'],
    ['X-Amz-Expires', '86400'],
    ['X-Amz-SignedHeaders', 'host'],
  ] as const;
  const canonical = [
    'GET',
    '/test.txt',
    'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host',
    'host:examplebucket.s3.amazonaws.com',
    '',
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  test('the canonical request', () => {
    expect(canonicalRequest({ ...request, query }, UNSIGNED_PAYLOAD)).toBe(canonical);
  });

  test('the string to sign', async () => {
    expect(await stringToSign(canonical, ctx)).toBe(
      [
        'AWS4-HMAC-SHA256',
        '20130524T000000Z',
        '20130524/us-east-1/s3/aws4_request',
        '3bfa292879f6447bbcda7001decf97f4a54dc650c8942174ae0a9121cf58ad04',
      ].join('\n'),
    );
  });

  test('the URL and its signature', async () => {
    expect(await presign(request, ctx, 86400)).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });
});

describe('signing in the headers, against the AWS examples', () => {
  test('GET an object with a Range header', async () => {
    const request: SignableRequest = { method: 'GET', host, path: '/test.txt', headers: { Range: 'bytes=0-9' } };
    const headers = { ...request.headers, 'x-amz-content-sha256': EMPTY, 'x-amz-date': '20130524T000000Z' };
    const canonical = canonicalRequest({ ...request, headers }, EMPTY);
    expect(canonical).toBe(
      [
        'GET',
        '/test.txt',
        '',
        'host:examplebucket.s3.amazonaws.com',
        'range:bytes=0-9',
        `x-amz-content-sha256:${EMPTY}`,
        'x-amz-date:20130524T000000Z',
        '',
        'host;range;x-amz-content-sha256;x-amz-date',
        EMPTY,
      ].join('\n'),
    );
    expect(await sha256Hex(canonical)).toBe('7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972');

    const signed = await signHeaders(request, ctx);
    expect(signed.url).toBe('https://examplebucket.s3.amazonaws.com/test.txt');
    expect(signed.headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  test('PUT an object: a body, and a path that needs encoding', async () => {
    const signed = await signHeaders(
      {
        method: 'PUT',
        host,
        path: encodePath('/test$file.text'),
        headers: { Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
      },
      ctx,
      'Welcome to Amazon S3.',
    );
    expect(signed.headers['x-amz-content-sha256']).toBe('44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
    expect(signatureOf(signed.headers.authorization)).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });

  test('a subresource without a value', async () => {
    const signed = await signHeaders({ method: 'GET', host, path: '/', query: [['lifecycle', '']] }, ctx);
    expect(signed.url).toBe('https://examplebucket.s3.amazonaws.com/?lifecycle=');
    expect(signatureOf(signed.headers.authorization)).toBe('fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
  });

  test('query parameters, sorted', async () => {
    const signed = await signHeaders({ method: 'GET', host, path: '/', query: [['prefix', 'J'], ['max-keys', '2']] }, ctx);
    expect(signed.url).toBe('https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J');
    expect(signatureOf(signed.headers.authorization)).toBe('34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  });
});
