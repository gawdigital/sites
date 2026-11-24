// File names: the customer's own name is kept for display and for the download, and a tame form of it goes into
// the object key, where it has to survive URLs, rclone and a technician's file system.

/** The longest original name we accept and store. */
export const MAX_ORIGINAL_NAME = 255;
/** The longest sanitised name in a key; the extension is kept when the stem is cut. */
export const MAX_KEY_NAME = 120;
const MAX_EXTENSION = 16;

/** The lower-case extension without the dot; empty for a name without one, and for a dot file such as `.env`. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Letters without their accents, everything outside `A-Z a-z 0-9 . _ -` as a hyphen, runs collapsed. */
function tame(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\.{2,}/g, '.');
}

/**
 * A name safe as the last segment of an object key: ASCII only, no slashes or backslashes (so no directories and
 * no `..`), no leading dot or hyphen, at most `MAX_KEY_NAME` characters with the extension preserved, in lower case. Only the part
 * after the last path separator counts, since some browsers send a full path. Never empty: falls back to `file`.
 */
export function sanitiseFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  const ext = tame(extensionOf(base)).replace(/[^a-z0-9]/g, '');
  const suffix = ext && ext.length <= MAX_EXTENSION ? `.${ext}` : '';
  const stem = tame(suffix ? base.slice(0, base.lastIndexOf('.')) : base)
    .replace(/^[.-]+/, '')
    .slice(0, MAX_KEY_NAME - suffix.length)
    .replace(/[.-]+$/, '');
  return `${stem || 'file'}${suffix}`;
}

/** The original name as we store it: control characters and path separators out, trimmed, capped. */
export function cleanOriginalName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  return base
    .replace(/[\u0000-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/g, '')
    .trim()
    .slice(0, MAX_ORIGINAL_NAME);
}

/**
 * A `Content-Disposition` value that makes a browser save the file under its original name (RFC 6266): an ASCII
 * fallback in `filename` and the real name, percent-encoded UTF-8, in `filename*`.
 */
export function contentDisposition(originalName: string): string {
  const name = cleanOriginalName(originalName) || 'file';
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${sanitiseFileName(name)}"; filename*=UTF-8''${encoded}`;
}
