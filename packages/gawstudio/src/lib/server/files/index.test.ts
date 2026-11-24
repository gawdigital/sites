import { expect, test } from 'bun:test';

import * as files from './index.ts';

// The whole flow through the public API, against a pretend R2: start, plan, presign, resume, complete, expire.
test('an upload from start to deletion', async () => {
  const config = { accountId: 'account', bucket: 'bucket', accessKeyId: 'TESTKEY', secretAccessKey: 'test-secret' };
  const settings = { ...files.DEFAULT_FILE_SETTINGS, partBytes: 8 * files.MiB };
  const now = new Date('2026-11-24T10:00:00Z');
  const file = { name: 'Píseň.wav', size: 20 * files.MiB, type: 'audio/wav' };
  const ref = { orderId: 'o1', kind: 'sources', trackId: 't1', fileId: 'f1' } as const;

  const answers = [
    '<InitiateMultipartUploadResult><UploadId>up1</UploadId></InitiateMultipartUploadResult>',
    `<ListPartsResult><IsTruncated>false</IsTruncated><Part><PartNumber>1</PartNumber><ETag>"a"</ETag><Size>${8 * files.MiB}</Size></Part></ListPartsResult>`,
    '<CompleteMultipartUploadResult><ETag>"abc-3"</ETag></CompleteMultipartUploadResult>',
  ];
  const store = files.s3Store(config, async () => new Response(answers.shift()), () => now);

  expect(files.validateUpload(file, settings)).toEqual({ ok: true });
  const key = files.objectKey(ref, file.name);
  const uploadId = await store.createMultipartUpload(key, { contentType: file.type, originalName: file.name });
  let record = files.initiate(ref, file, uploadId, settings, now);
  expect(record).toMatchObject({ key, partCount: 3, state: 'initiated' });

  const missing = files.missingParts(record, await store.listParts(key, uploadId));
  expect(missing).toEqual([2, 3]);
  const urls = await Promise.all(
    missing.map((partNumber) => files.presignUploadPart(config, { key, uploadId, partNumber, expiresIn: settings.uploadUrlSeconds, now })),
  );
  expect(urls[0]).toStartWith('https://account.r2.cloudflarestorage.com/bucket/orders/o1/sources/t1/f1/Pisen.wav?X-Amz-Algorithm=');
  expect(urls[0]).toContain('&partNumber=2&uploadId=up1&X-Amz-Signature=');

  const etag = await store.completeMultipartUpload(key, uploadId, [1, 2, 3].map((n) => ({ partNumber: n, etag: `"${n}"` })));
  record = files.advance(record, { type: 'completed', etag }, now)!;
  expect(record).toMatchObject({ state: 'completed', etag: '"abc-3"' });

  expect(files.lastDay(now, settings)).toBe('2026-12-24');
  expect(files.deletionPlan('o1', [record]).objects).toEqual([key]);
});
