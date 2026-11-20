// What gawdigital.cz's contact form asks and how its message reads. Reading and cleaning the posted fields and
// choosing the result page are shared by the sites (`@gaw/contact/form.ts`); this stays free of platform imports,
// so it unit-tests under Bun.
import { pathOf } from '@gaw/i18n/locale.ts';
import { field, has, readOrigin as origin, readSender, type Mail, type Origin as FormOrigin, type Sender } from '@gaw/contact/form.ts';

export { MAX_EMAIL, MAX_MESSAGE, cleanLine, cleanText, isEmail, resultPath, type Mail } from '@gaw/contact/form.ts';

export const PRODUCTS = { 'midi-control': 'MIDI Control for Fireface', other: 'Other' } as const;
export const TOPICS = { problem: 'Problem', purchase: 'Purchase & trial', other: 'Other' } as const;
export const SOURCES = ['contact', 'support'] as const;

export type Product = keyof typeof PRODUCTS;
export type Topic = keyof typeof TOPICS;
export type Source = (typeof SOURCES)[number];

/** Where the form was sent from: decides the result page, valid or not. */
export type Origin = FormOrigin<Source>;

export interface Submission extends Sender<Source> {
  product: Product;
  topic: Topic;
}

/** The form's origin, read leniently: anything unknown falls back to the English contact page. */
export const readOrigin = (data: FormData): Origin => origin(data, SOURCES);

/** The posted form, validated: the submission, or `undefined` when any field is missing or malformed. */
export function readSubmission(data: FormData): Submission | undefined {
  const sender = readSender(data, SOURCES);
  const product = field(data, 'product');
  const topic = field(data, 'topic');
  if (!sender || !has(PRODUCTS, product) || !has(TOPICS, topic)) return undefined;
  const { locale, source, email, message, token } = sender;
  return { locale, source, email, product, topic, message, token };
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
