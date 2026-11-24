// What the owner can change about file transfer without a code change. The values here are the documented
// defaults; where they will be stored (a config file, the database) is the caller's business.

export const KiB = 1024;
export const MiB = 1024 * KiB;
export const GiB = 1024 * MiB;
export const TiB = 1024 * GiB;

export interface FileSettings {
  /** Lower-case extensions without the dot. An upload's name must end in one of them. */
  allowedExtensions: readonly string[];
  /**
   * MIME types as the browser reports them, `audio/*` style wildcards allowed. Browsers disagree about audio types
   * and send none at all for some files, so a missing type passes and the extension decides.
   */
  allowedMimeTypes: readonly string[];
  maxFileBytes: number;
  /** The cap on everything one order holds, sources and results together. */
  maxOrderBytes: number;
  /** The preferred size of a multipart part; `planParts` raises it when a file would need over 10,000 parts. */
  partBytes: number;
  /** How long a presigned URL for one part stays valid, in seconds. */
  uploadUrlSeconds: number;
  /** How long a download URL made on a click stays valid, in seconds. */
  downloadUrlSeconds: number;
  /** Files are kept this many days after delivery, sources and results alike. */
  retentionDays: number;
  /** The reminder goes out this many days before the last day. */
  reminderDays: number;
  /** The local hour (0 to 23) the reminder is due. */
  reminderHour: number;
  /** The time zone the dates shown to the customer are in. */
  timeZone: string;
  /** Hosts a pasted link may point to, subdomains included; an empty list allows any public https host. */
  linkHosts: readonly string[];
}

export const DEFAULT_FILE_SETTINGS: FileSettings = {
  allowedExtensions: ['wav', 'aif', 'aiff', 'flac', 'mp3', 'm4a', 'ogg', 'zip'],
  allowedMimeTypes: ['audio/*', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
  maxFileBytes: 20 * GiB,
  maxOrderBytes: 50 * GiB,
  partBytes: 32 * MiB,
  uploadUrlSeconds: 60 * 60,
  downloadUrlSeconds: 5 * 60,
  retentionDays: 30,
  reminderDays: 5,
  reminderHour: 9,
  timeZone: 'Europe/Prague',
  linkHosts: ['wetransfer.com', 'we.tl', 'drive.google.com', 'docs.google.com', 'dropbox.com'],
};
