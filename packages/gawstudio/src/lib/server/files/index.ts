// File transfer for orders through Cloudflare R2 (issue #29): presigned multipart uploads and downloads, upload
// planning, the pasted-link fallback and retention. Groundwork: no routes, no database, no UI.
export { DEFAULT_FILE_SETTINGS, GiB, KiB, MiB, TiB, type FileSettings } from './settings.ts';
export { cleanOriginalName, contentDisposition, extensionOf, sanitiseFileName, MAX_KEY_NAME, MAX_ORIGINAL_NAME } from './names.ts';
export {
  MAX_PARTS,
  MAX_PRESIGN_SECONDS,
  MIN_PRESIGN_SECONDS,
  presignDownload,
  presignUploadPart,
  r2Host,
  R2Error,
  s3Store,
  type CreateOptions,
  type Fetch,
  type FileStore,
  type PresignDownload,
  type PresignUploadPart,
  type R2Config,
  type StoredObject,
  type UploadedPart,
} from './r2.ts';
export {
  advance,
  initiate,
  kindPrefix,
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
  type Candidate,
  type FileKind,
  type FileRef,
  type PartPlan,
  type Progress,
  type Rejection,
  type UploadEvent,
  type UploadRecord,
  type UploadState,
  type Validation,
} from './plan.ts';
export { MAX_LINK, validateLink, type LinkRejection, type LinkResult } from './links.ts';
export { deletionPlan, expiresAt, isExpired, lastDay, reminderAt, type DeletionPlan } from './retention.ts';
