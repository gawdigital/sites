// The fallback without JavaScript: instead of uploading, the customer pastes a link to the files (WeTransfer,
// Google Drive, Dropbox). The link is shown to a technician who will open it, so it is checked like any other
// untrusted input: https only, no credentials, a public host name, and optionally only hosts from the settings.
import type { FileSettings } from './settings.ts';

export const MAX_LINK = 2048;

export type LinkRejection = 'empty' | 'too-long' | 'invalid' | 'scheme' | 'credentials' | 'host' | 'host-not-allowed';

export type LinkResult =
  | { ok: true; /** The normalised link, safe to store and to put in an `href`. */ url: string; host: string }
  | { ok: false; reason: LinkRejection };

/** Whether `host` is `allowed` or one of its subdomains. */
function matches(host: string, allowed: string): boolean {
  const a = allowed.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  return a !== '' && (host === a || host.endsWith(`.${a}`));
}

/** A name with a dot and an alphabetic top-level domain: no IP address, no `localhost`, no intranet name. */
function isPublicName(host: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:[a-z]{2,}|xn--[a-z0-9-]+)$/.test(host);
}

/**
 * Validates and normalises a pasted link. A link without a scheme (`we.tl/t-abc`, as people copy them) is read as
 * https; any other scheme, `http` included, is refused. The path, query and fragment are kept as they are, since
 * share links carry their secret there.
 */
export function validateLink(input: string, settings: Pick<FileSettings, 'linkHosts'>): LinkResult {
  const no = (reason: LinkRejection): LinkResult => ({ ok: false, reason });
  const text = input.trim();
  if (!text) return no('empty');
  if (text.length > MAX_LINK) return no('too-long');
  if (/[\s\u0000-\u001F\u007F-\u009F\\]/.test(text)) return no('invalid');

  // A scheme has no dot here, so `example.com:8080/x` is a host with a port (refused below), not a scheme.
  const scheme = text.match(/^([a-z][a-z0-9+-]*):/i)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'https') return no('scheme');

  let url: URL;
  try {
    url = new URL(scheme ? text : `https://${text}`);
  } catch {
    return no('invalid');
  }
  if (url.protocol !== 'https:') return no('scheme');
  if (url.username || url.password) return no('credentials');

  const host = url.hostname.replace(/\.$/, '');
  if (url.port || !isPublicName(host)) return no('host');
  if (settings.linkHosts.length > 0 && !settings.linkHosts.some((allowed) => matches(host, allowed))) return no('host-not-allowed');

  url.hostname = host;
  return { ok: true, url: url.href, host };
}
