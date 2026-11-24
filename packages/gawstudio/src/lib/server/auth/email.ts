// An account is its e-mail address, so two spellings of one mailbox must be one account: this is the only place
// that decides what "the same address" means.

export const MAX_EMAIL = 254;
const MAX_LOCAL = 64;

// One `@`, no white space, a dotted domain whose labels neither start nor end with a hyphen.
const LOCAL = /^[^\s@]+$/u;
const LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u;
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

/**
 * The address as the account's identity, or `undefined` when it is not an address.
 *
 * Surrounding white space is trimmed and the whole address is lower-cased (after Unicode NFC). The domain is
 * case-insensitive by definition. The local part is, strictly (RFC 5321), the receiving server's business, but
 * no mailbox provider of note tells `Name@` from `name@`, while treating them as two accounts would let a second
 * account shadow the first; so it is lower-cased too. Nothing provider-specific happens: dots and `+tags` stay,
 * since outside one provider they do name different mailboxes.
 *
 * A control character (a line break above all) is refused rather than repaired: it is an injection attempt.
 */
export function normaliseEmail(input: string): string | undefined {
  if (CONTROL.test(input)) return undefined;
  const email = input.trim().normalize('NFC').toLowerCase();
  const at = email.lastIndexOf('@');
  if (email.length > MAX_EMAIL || at < 1) return undefined;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > MAX_LOCAL || !LOCAL.test(local)) return undefined;
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((label) => label.length <= 63 && LABEL.test(label))) return undefined;
  return email;
}

export const isEmail = (input: string): boolean => normaliseEmail(input) !== undefined;
