// Upload records on D1: `UploadRecord` (`../files/plan.ts`), keyed by the object's key in the bucket. The record's
// ISO instants are stored as epoch milliseconds and come back as the same strings.
import type { FileKind, UploadRecord, UploadState } from '../files/plan.ts';
import { changesOf, isoOf, msOf, oneOf, rowsOf } from './d1.ts';
import type { D1Like } from './d1.ts';

interface UploadRow {
  object_key: string;
  order_id: string;
  kind: string;
  track_id: string;
  file_id: string;
  size: number;
  part_size: number;
  part_count: number;
  upload_id: string;
  original_name: string;
  content_type: string;
  state: string;
  etag: string | null;
  created_at: number;
  updated_at: number;
}

const KINDS: readonly FileKind[] = ['sources', 'results'];
const STATES: readonly UploadState[] = ['initiated', 'uploading', 'completed', 'aborted'];

const upload = (row: UploadRow): UploadRecord => ({
  orderId: row.order_id,
  kind: oneOf(KINDS, row.kind, 'uploads.kind'),
  trackId: row.track_id,
  fileId: row.file_id,
  size: row.size,
  partSize: row.part_size,
  partCount: row.part_count,
  key: row.object_key,
  uploadId: row.upload_id,
  originalName: row.original_name,
  contentType: row.content_type,
  state: oneOf(STATES, row.state, 'uploads.state'),
  createdAt: isoOf(row.created_at),
  updatedAt: isoOf(row.updated_at),
  ...(row.etag === null ? {} : { etag: row.etag }),
});

export class UploadRepository {
  readonly #db: D1Like;

  constructor(db: D1Like) {
    this.#db = db;
  }

  /**
   * Stores the record of an upload R2 has just started (`initiate`). `false` when the key, or the order's file
   * id, is already taken: the caller aborts the upload it started. The order must exist.
   */
  async insert(record: UploadRecord): Promise<boolean> {
    const result = await this.#db
      .prepare(
        `INSERT INTO uploads (object_key, order_id, kind, track_id, file_id, size, part_size, part_count, upload_id,
                              original_name, content_type, state, etag, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .bind(
        record.key,
        record.orderId,
        record.kind,
        record.trackId,
        record.fileId,
        record.size,
        record.partSize,
        record.partCount,
        record.uploadId,
        record.originalName,
        record.contentType,
        record.state,
        record.etag ?? null,
        msOf(record.createdAt),
        msOf(record.updatedAt),
      )
      .run();
    return changesOf(result) === 1;
  }

  async get(key: string): Promise<UploadRecord | undefined> {
    const row = await this.#db.prepare('SELECT * FROM uploads WHERE object_key = ?').bind(key).first<UploadRow>();
    return row ? upload(row) : undefined;
  }

  /** An order's uploads in every state, oldest first: what `orderBytes` sums. */
  async ofOrder(orderId: string): Promise<UploadRecord[]> {
    const result = await this.#db.prepare('SELECT * FROM uploads WHERE order_id = ? ORDER BY created_at, object_key').bind(orderId).all<UploadRow>();
    return rowsOf<UploadRow>(result).map(upload);
  }

  /**
   * Stores the record `advance` returned for `previous`. `true` for the caller that moved the upload on from
   * `previous.state`; `false` when it had already moved (two completions of one upload: one wins).
   */
  async advance(previous: UploadRecord, next: UploadRecord): Promise<boolean> {
    const result = await this.#db
      .prepare('UPDATE uploads SET state = ?1, etag = ?2, updated_at = ?3 WHERE object_key = ?4 AND state = ?5')
      .bind(next.state, next.etag ?? null, msOf(next.updatedAt), previous.key, previous.state)
      .run();
    return changesOf(result) === 1;
  }

  /** The uploads still running that nothing has touched since `before`: the ones to abort at R2. */
  async stale(before: number, limit = 50): Promise<UploadRecord[]> {
    const result = await this.#db
      .prepare(`SELECT * FROM uploads WHERE state IN ('initiated', 'uploading') AND updated_at < ? ORDER BY updated_at LIMIT ?`)
      .bind(before, limit)
      .all<UploadRow>();
    return rowsOf<UploadRow>(result).map(upload);
  }

  /** Forgets one upload; the object is the caller's to delete. */
  async delete(key: string): Promise<boolean> {
    const result = await this.#db.prepare('DELETE FROM uploads WHERE object_key = ?').bind(key).run();
    return changesOf(result) === 1;
  }

  /** Forgets every upload of an order (retention, erasure); the objects are the caller's to delete. Returns how many. */
  async deleteOfOrder(orderId: string): Promise<number> {
    const result = await this.#db.prepare('DELETE FROM uploads WHERE order_id = ?').bind(orderId).run();
    return changesOf(result);
  }
}
