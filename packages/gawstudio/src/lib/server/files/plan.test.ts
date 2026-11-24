import { describe, expect, test } from 'bun:test';

import { contentDisposition, extensionOf, sanitiseFileName, cleanOriginalName, MAX_KEY_NAME } from './names.ts';
import {
  advance,
  initiate,
  MAX_OBJECT_BYTES,
  MAX_PART_BYTES,
  MIN_PART_BYTES,
  missingParts,
  objectKey,
  orderBytes,
  orderPrefix,
  partRange,
  planParts,
  progress,
  validateUpload,
  type FileRef,
} from './plan.ts';
import { DEFAULT_FILE_SETTINGS, GiB, MiB, TiB } from './settings.ts';

const settings = DEFAULT_FILE_SETTINGS;
const ref: FileRef = { orderId: 'ord_1', kind: 'sources', trackId: 'trk-2', fileId: 'f3' };

describe('file names', () => {
  test('accents go, other scripts and symbols become hyphens, the extension stays, in lower case', () => {
    expect(sanitiseFileName('Píseň č. 1 (finální mix).WAV')).toBe('Pisen-c.-1-finalni-mix.wav');
    expect(sanitiseFileName('Žluťoučký kůň.flac')).toBe('Zlutoucky-kun.flac');
    expect(sanitiseFileName('песня 🎵.wav')).toBe('file.wav');
    expect(sanitiseFileName('ﬁnal①.mp3')).toBe('final1.mp3');
  });

  test('no path survives: slashes, backslashes and dot segments', () => {
    expect(sanitiseFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitiseFileName('C:\\Users\\me\\Stems\\kick.wav')).toBe('kick.wav');
    expect(sanitiseFileName('a/../b/..')).toBe('file');
    expect(sanitiseFileName('..')).toBe('file');
    expect(sanitiseFileName('...hidden...wav')).toBe('hidden.wav');
    expect(sanitiseFileName('.env')).toBe('env');
    expect(sanitiseFileName('-rf.wav')).toBe('rf.wav');
    expect(sanitiseFileName('a%2F..%2Fb.wav')).toBe('a-2F.-2Fb.wav');
  });

  test('nothing left is still a name', () => {
    for (const name of ['', '   ', '///', '\u0000', '🎵']) expect(sanitiseFileName(name)).toBe('file');
  });

  test('a very long name is cut, its extension kept', () => {
    const name = sanitiseFileName(`${'a'.repeat(500)}.flac`);
    expect(name).toHaveLength(MAX_KEY_NAME);
    expect(name).toEndWith('a.flac');
    expect(sanitiseFileName('b'.repeat(500))).toBe('b'.repeat(MAX_KEY_NAME));
    // What follows the last dot is not an extension when it is this long.
    expect(sanitiseFileName(`x.${'c'.repeat(300)}`)).toHaveLength(MAX_KEY_NAME);
  });

  test('the result is always a safe segment', () => {
    for (const name of ['Píseň.wav', '../x', 'a b\tc\n.wav', 'q?#&=.mp3', `${'ž'.repeat(400)}.wav`, 'con..wav']) {
      const clean = sanitiseFileName(name);
      expect(clean).toMatch(/^[A-Za-z0-9_][A-Za-z0-9._-]*$/);
      expect(clean).not.toContain('..');
      expect(clean.length).toBeLessThanOrEqual(MAX_KEY_NAME);
    }
  });

  test('the extension', () => {
    expect(extensionOf('a.b.WAV')).toBe('wav');
    expect(extensionOf('noext')).toBe('');
    expect(extensionOf('.env')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
  });

  test('the original name keeps its letters and loses control characters and paths', () => {
    expect(cleanOriginalName('  dir/Píseň\u0000 č. 1.wav\r\n')).toBe('Píseň č. 1.wav');
    expect(cleanOriginalName('x'.repeat(400))).toHaveLength(255);
  });

  test('the download disposition cannot be broken out of', () => {
    expect(contentDisposition('a"b; filename=evil.exe\r\nX: y.wav')).toBe(
      `attachment; filename="a-b-filename-evil.exeX-y.wav"; filename*=UTF-8''a%22b%3B%20filename%3Devil.exeX%3A%20y.wav`,
    );
    expect(contentDisposition('')).toBe(`attachment; filename="file"; filename*=UTF-8''file`);
  });
});

describe('object keys', () => {
  test('orders/<order>/<kind>/<track>/<file>/<name>', () => {
    expect(objectKey(ref, 'Píseň 1.wav')).toBe('orders/ord_1/sources/trk-2/f3/Pisen-1.wav');
    expect(objectKey({ ...ref, kind: 'results' }, 'master.wav')).toBe('orders/ord_1/results/trk-2/f3/master.wav');
    expect(orderPrefix('ord_1')).toBe('orders/ord_1/');
  });

  test('an id that could leave its segment throws', () => {
    for (const bad of ['', '..', 'a/b', 'a b', 'ž', 'x'.repeat(65)]) {
      expect(() => objectKey({ ...ref, orderId: bad }, 'a.wav')).toThrow(RangeError);
      expect(() => objectKey({ ...ref, trackId: bad }, 'a.wav')).toThrow(RangeError);
      expect(() => objectKey({ ...ref, fileId: bad }, 'a.wav')).toThrow(RangeError);
    }
  });

  test('the longest key stays far below R2’s 1,024 bytes', () => {
    const long = 'x'.repeat(64);
    const key = objectKey({ orderId: long, kind: 'results', trackId: long, fileId: long }, 'y'.repeat(999));
    expect(new TextEncoder().encode(key).length).toBeLessThan(1024);
  });
});

describe('validation', () => {
  const file = { name: 'Kick.WAV', size: 100 * MiB, type: 'audio/wav' };

  test('an allowed file passes', () => {
    expect(validateUpload(file, settings)).toEqual({ ok: true });
    expect(validateUpload({ ...file, type: '' }, settings)).toEqual({ ok: true });
    expect(validateUpload({ name: 'stems.zip', size: 1 }, settings)).toEqual({ ok: true });
    expect(validateUpload({ ...file, type: 'Audio/X-WAV; charset=binary' }, settings)).toEqual({ ok: true });
  });

  test('each rule has its reason', () => {
    expect(validateUpload({ ...file, name: ' \u0000 ' }, settings)).toEqual({ ok: false, reason: 'name' });
    for (const size of [0, -1, 1.5, Number.NaN]) expect(validateUpload({ ...file, size }, settings)).toEqual({ ok: false, reason: 'empty' });
    for (const name of ['virus.exe', 'noext', 'kick.wav.exe', '.wav']) expect(validateUpload({ ...file, name }, settings)).toEqual({ ok: false, reason: 'extension' });
    expect(validateUpload({ ...file, type: 'text/html' }, settings)).toEqual({ ok: false, reason: 'type' });
    expect(validateUpload({ ...file, type: 'audiobook/x' }, settings)).toEqual({ ok: false, reason: 'type' });
  });

  test('the caps: per file, and per order with what it already holds', () => {
    expect(validateUpload({ ...file, size: settings.maxFileBytes }, settings)).toEqual({ ok: true });
    expect(validateUpload({ ...file, size: settings.maxFileBytes + 1 }, settings)).toEqual({ ok: false, reason: 'file-too-large' });
    expect(validateUpload(file, settings, settings.maxOrderBytes - file.size)).toEqual({ ok: true });
    expect(validateUpload(file, settings, settings.maxOrderBytes - file.size + 1)).toEqual({ ok: false, reason: 'order-too-large' });
  });

  test('no setting lifts a file above what R2 can hold', () => {
    const open = { ...settings, maxFileBytes: Number.MAX_SAFE_INTEGER, maxOrderBytes: Number.MAX_SAFE_INTEGER };
    expect(validateUpload({ ...file, size: MAX_OBJECT_BYTES }, open)).toEqual({ ok: true });
    expect(validateUpload({ ...file, size: MAX_OBJECT_BYTES + 1 }, open)).toEqual({ ok: false, reason: 'file-too-large' });
  });

  test('a type list written with capitals matches all the same, wildcards included', () => {
    const capitals = { ...settings, allowedMimeTypes: ['Audio/*', 'Application/ZIP'] };
    expect(validateUpload({ ...file, type: 'audio/wav' }, capitals)).toEqual({ ok: true });
    expect(validateUpload({ ...file, type: 'AUDIO/x-wav' }, capitals)).toEqual({ ok: true });
    expect(validateUpload({ ...file, type: 'application/zip' }, capitals)).toEqual({ ok: true });
    expect(validateUpload({ ...file, type: 'text/html' }, capitals)).toEqual({ ok: false, reason: 'type' });
  });

  test('an empty type list leaves the decision to the extension', () => {
    expect(validateUpload({ ...file, type: 'text/html' }, { ...settings, allowedMimeTypes: [] })).toEqual({ ok: true });
  });

  test('the order’s bytes leave aborted uploads out', () => {
    expect(orderBytes([{ state: 'completed', size: 5 }, { state: 'uploading', size: 3 }, { state: 'initiated', size: 2 }, { state: 'aborted', size: 100 }])).toBe(10);
  });
});

describe('parts', () => {
  const P = 32 * MiB;

  test('the limits', () => {
    expect(MIN_PART_BYTES).toBe(5 * MiB);
    expect(MAX_PART_BYTES).toBe(5 * GiB - 5 * MiB);
    expect(MAX_OBJECT_BYTES).toBe(5 * TiB - 5 * GiB);
  });

  test('a tiny file is one part of its own size', () => {
    expect(planParts(1, P)).toEqual({ size: 1, partSize: P, partCount: 1 });
    expect(partRange(planParts(1, P), 1)).toEqual({ offset: 0, length: 1 });
    expect(planParts(P, P).partCount).toBe(1);
  });

  test('exactly N parts, and one byte more', () => {
    const exact = planParts(3 * P, P);
    expect(exact.partCount).toBe(3);
    expect(partRange(exact, 3)).toEqual({ offset: 2 * P, length: P });
    const more = planParts(3 * P + 1, P);
    expect(more.partCount).toBe(4);
    expect(partRange(more, 4)).toEqual({ offset: 3 * P, length: 1 });
    expect(() => partRange(more, 5)).toThrow(RangeError);
    expect(() => partRange(more, 0)).toThrow(RangeError);
  });

  test('5 GiB', () => {
    expect(planParts(5 * GiB, P)).toEqual({ size: 5 * GiB, partSize: P, partCount: 160 });
  });

  test('the preferred size is kept within R2’s part limits', () => {
    expect(planParts(GiB, 1).partSize).toBe(MIN_PART_BYTES);
    expect(planParts(GiB, Number.NaN).partSize).toBe(MIN_PART_BYTES);
    expect(planParts(GiB, 100 * GiB).partSize).toBe(MAX_PART_BYTES);
  });

  test('10,000 parts at the preferred size is the last file that keeps it', () => {
    expect(planParts(10_000 * P, P)).toEqual({ size: 10_000 * P, partSize: P, partCount: 10_000 });
    const over = planParts(10_000 * P + 1, P);
    expect(over.partSize).toBe(33 * MiB);
    expect(over.partCount).toBeLessThanOrEqual(10_000);
  });

  test('a big file gets larger parts, in whole MiB, to stay within 10,000', () => {
    const plan = planParts(400 * GiB, P);
    expect(plan.partSize).toBe(41 * MiB);
    expect(plan.partCount).toBe(Math.ceil((400 * GiB) / (41 * MiB)));
    expect(plan.partCount).toBeLessThanOrEqual(10_000);
  });

  test('the largest object R2 holds still fits', () => {
    const plan = planParts(MAX_OBJECT_BYTES, P);
    expect(plan.partCount).toBeLessThanOrEqual(10_000);
    expect(plan.partSize).toBeLessThanOrEqual(MAX_PART_BYTES);
    expect(plan.partSize * plan.partCount).toBeGreaterThanOrEqual(MAX_OBJECT_BYTES);
    const last = partRange(plan, plan.partCount);
    expect(last.offset + last.length).toBe(MAX_OBJECT_BYTES);
  });

  test('no plan for no bytes, or for more than R2 holds', () => {
    for (const size of [0, -1, 1.5, Number.NaN, MAX_OBJECT_BYTES + 1]) expect(() => planParts(size, P)).toThrow(RangeError);
  });
});

describe('resuming', () => {
  const P = 8 * MiB;
  const plan = planParts(3 * P + 100, P);

  test('nothing uploaded: every part is missing', () => {
    expect(missingParts(plan, [])).toEqual([1, 2, 3, 4]);
  });

  test('the listed parts are skipped, in any order', () => {
    const listed = [{ partNumber: 4, etag: '"d"', size: 100 }, { partNumber: 2, etag: '"b"', size: P }];
    expect(progress(plan, listed)).toEqual({
      done: [{ partNumber: 2, etag: '"b"', size: P }, { partNumber: 4, etag: '"d"', size: 100 }],
      missing: [1, 3],
      uploadedBytes: P + 100,
    });
  });

  test('a part of the wrong size, or outside the plan, is uploaded again or ignored', () => {
    const listed = [
      { partNumber: 1, etag: '"a"', size: P - 1 },
      { partNumber: 4, etag: '"d"', size: P },
      { partNumber: 5, etag: '"e"', size: P },
      { partNumber: 0, etag: '"z"', size: P },
      { partNumber: 3, etag: '"c"' },
    ];
    expect(progress(plan, listed)).toEqual({ done: [{ partNumber: 3, etag: '"c"' }], missing: [1, 2, 4], uploadedBytes: P });
  });

  test('everything there: nothing missing, and the parts are ready for completing', () => {
    const listed = [1, 2, 3, 4].map((n) => ({ partNumber: n, etag: `"${n}"`, size: n === 4 ? 100 : P }));
    const state = progress(plan, listed);
    expect(state.missing).toEqual([]);
    expect(state.done).toEqual(listed);
    expect(state.uploadedBytes).toBe(plan.size);
  });
});

describe('the upload record', () => {
  const t0 = new Date('2026-11-24T10:00:00Z');
  const t1 = new Date('2026-11-24T10:05:00Z');
  const record = initiate(ref, { name: 'dir/Píseň 1.wav', size: 100 * MiB, type: '' }, 'upload-1', settings, t0);

  test('starts as initiated, with the key, the plan and the original name', () => {
    expect(record).toEqual({
      orderId: 'ord_1',
      kind: 'sources',
      trackId: 'trk-2',
      fileId: 'f3',
      size: 100 * MiB,
      partSize: 32 * MiB,
      partCount: 4,
      key: 'orders/ord_1/sources/trk-2/f3/Pisen-1.wav',
      uploadId: 'upload-1',
      originalName: 'Píseň 1.wav',
      contentType: 'application/octet-stream',
      state: 'initiated',
      createdAt: '2026-11-24T10:00:00.000Z',
      updatedAt: '2026-11-24T10:00:00.000Z',
    });
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
  });

  test('initiated → uploading → completed', () => {
    const uploading = advance(record, { type: 'part-uploaded' }, t1);
    expect(uploading).toMatchObject({ state: 'uploading', createdAt: record.createdAt, updatedAt: '2026-11-24T10:05:00.000Z' });
    expect(advance(uploading!, { type: 'part-uploaded' }, t1)?.state).toBe('uploading');
    expect(advance(uploading!, { type: 'completed', etag: '"abc-4"' }, t1)).toMatchObject({ state: 'completed', etag: '"abc-4"' });
    expect(record.state).toBe('initiated');
  });

  test('an upload can be completed or aborted before the server saw a part', () => {
    expect(advance(record, { type: 'completed', etag: '"x-4"' }, t1)?.state).toBe('completed');
    expect(advance(record, { type: 'aborted' }, t1)?.state).toBe('aborted');
  });

  test('completed and aborted are final', () => {
    for (const end of [advance(record, { type: 'completed', etag: '"x"' }, t1)!, advance(record, { type: 'aborted' }, t1)!]) {
      expect(advance(end, { type: 'part-uploaded' }, t1)).toBeUndefined();
      expect(advance(end, { type: 'completed', etag: '"y"' }, t1)).toBeUndefined();
      expect(advance(end, { type: 'aborted' }, t1)).toBeUndefined();
    }
  });
});
