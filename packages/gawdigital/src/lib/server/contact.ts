// The contact form's server side, kept free of platform imports so it unit-tests under Bun: reading and validating
// the posted fields, composing the message, and choosing where the visitor goes next.
import { isLocale, pathOf } from '@gaw/i18n/locale.ts';

import type { FormState } from '../forms.ts';

export const PRODUCTS = { 'midi-control': 'MIDI Control for Fireface', other: 'Other' } as const;
export const TOPICS = { problem: 'Problem', purchase: 'Purchase & trial', other: 'Other' } as const;
export const SOURCES = ['contact', 'support'] as const;

export const MAX_EMAIL = 254;
export const MAX_MESSAGE = 5000;

export type Product = keyof typeof PRODUCTS;
export type Topic = keyof typeof TOPICS;
export type Source = (typeof SOURCES)[number];

/** Where the form was sent from: decides the result page, valid or not. */
export interface Origin {
  locale: string;
  source: Source;
}

export interface Submission extends Origin {
  email: string;
  product: Product;
  topic: Topic;
  message: string;
  token: string;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const has = <T extends object>(o: T, k: string): k is Extract<keyof T, string> => Object.hasOwn(o, k);

const field = (data: FormData, name: string): string => {
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

/** The form's origin, read leniently: anything unknown falls back to the English contact page. */
export function readOrigin(data: FormData): Origin {
  const locale = field(data, 'locale');
  const source = field(data, 'source');
  return {
    locale: isLocale(locale) ? locale : 'en',
    source: (SOURCES as readonly string[]).includes(source) ? (source as Source) : 'contact',
  };
}

/** The posted form, validated: the submission, or `undefined` when any field is missing or malformed. */
export function readSubmission(data: FormData): Submission | undefined {
  const raw = field(data, 'email');
  const email = cleanLine(raw);
  const product = field(data, 'product');
  const topic = field(data, 'topic');
  const message = cleanText(field(data, 'message'));
  // A line break in the address is an attempt at header injection, not a typo: refuse rather than repair it.
  if (/[\r\n]/.test(raw) || !isEmail(email)) return undefined;
  if (!has(PRODUCTS, product) || !has(TOPICS, topic)) return undefined;
  if (message.length === 0 || message.length > MAX_MESSAGE) return undefined;
  return { ...readOrigin(data), email, product, topic, message, token: field(data, 'cf-turnstile-response') };
}

export interface Mail {
  subject: string;
  text: string;
  replyTo: string;
}

/** The message as it is delivered: a fixed subject from the chosen labels, the visitor's text as plain text. */
export function compose(s: Submission): Mail {
  return {
    subject: `[gawdigital.cz] ${PRODUCTS[s.product]} · ${TOPICS[s.topic]}`,
    replyTo: s.email,
    text: [
      `From: ${s.email}`,
      `Product: ${PRODUCTS[s.product]}`,
      `Topic: ${TOPICS[s.topic]}`,
      `Page: ${pathOf(`/${s.source}`, s.locale)} (${s.locale})`,
      '',
      s.message,
      '',
    ].join('\n'),
  };
}

/** The prerendered result page a visitor without JavaScript is sent to. */
export function resultPath(origin: Origin, state: FormState): string {
  return pathOf(`/${origin.source}/${state}`, origin.locale) + '#contact';
}
