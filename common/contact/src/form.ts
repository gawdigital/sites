// The contact form's server side that every site shares, kept free of platform imports so it unit-tests under Bun:
// reading and cleaning the posted fields, and choosing where the visitor goes next. What a site's form asks beyond
// the address and the message (a product, a topic), and how its message reads, is the site's own.
import { isLocale, pathOf } from '@gaw/i18n/locale.ts';

import type { FormState } from './states.ts';

export const MAX_EMAIL = 254;
export const MAX_MESSAGE = 5000;

/** Where the form was sent from: decides the result page, valid or not. */
export interface Origin<Source extends string = string> {
  locale: string;
  source: Source;
}

/** What every site's form posts: who writes, what, and the Turnstile token. */
export interface Sender<Source extends string = string> extends Origin<Source> {
  email: string;
  message: string;
  token: string;
}

export interface Mail {
  subject: string;
  text: string;
  replyTo: string;
}

/** A form's sources: the pages that hold it, the first being where an unreadable post is sent back to. */
export type Sources<Source extends string> = readonly [Source, ...Source[]];

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Whether `k` is one of the object's own keys: a posted value picks a label only by a key the site declared. */
export const has = <T extends object>(o: T, k: string): k is Extract<keyof T, string> => Object.hasOwn(o, k);

/** A posted text field; a missing one, or a file, reads as empty. */
export const field = (data: FormData, name: string): string => {
  const v = data.get(name);
  return typeof v === 'string' ? v : '';
};

/**
 * A message body as plain text: line breaks normalised to `\n`, every other control character (and the
 * invisible bidi controls) removed, surrounding white space trimmed.
 */
export function cleanText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .trim();
}

/** A single-line value (safe for a mail header): every control character removed, trimmed. */
export function cleanLine(s: string): string {
  return s.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, '').trim();
}

export function isEmail(s: string): boolean {
  return s.length <= MAX_EMAIL && EMAIL.test(s);
}

/** The form's origin, read leniently: anything unknown falls back to English and to the site's first source. */
export function readOrigin<Source extends string>(data: FormData, sources: Sources<Source>): Origin<Source> {
  const locale = field(data, 'locale');
  const source = field(data, 'source');
  return {
    locale: isLocale(locale) ? locale : 'en',
    source: (sources as readonly string[]).includes(source) ? (source as Source) : sources[0],
  };
}

/** The address, the message and the token, validated: `undefined` when the address or the message will not do. */
export function readSender<Source extends string>(data: FormData, sources: Sources<Source>): Sender<Source> | undefined {
  const raw = field(data, 'email');
  const email = cleanLine(raw);
  const message = cleanText(field(data, 'message'));
  // A line break in the address is an attempt at header injection, not a typo: refuse rather than repair it.
  if (/[\r\n]/.test(raw) || !isEmail(email)) return undefined;
  if (message.length === 0 || message.length > MAX_MESSAGE) return undefined;
  return { ...readOrigin(data, sources), email, message, token: field(data, 'cf-turnstile-response') };
}

/** The prerendered result page a visitor without JavaScript is sent to. */
export function resultPath(origin: Origin, state: FormState): string {
  return pathOf(`/${origin.source}/${state}`, origin.locale) + '#contact';
}
