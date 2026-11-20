// This site's contact form, kept free of platform imports so it unit-tests under Bun: what it asks beyond the shared
// fields (a topic, which decides whose desk the message lands on) and how its message reads.
import { field, has, readSender, type Mail, type Sender } from '@gaw/contact/form.ts';
import { pathOf } from '@gaw/i18n/locale.ts';

/** The topics, as the subject names them: a brand, or the group itself. */
export const TOPICS = { digital: 'G.A.W.Digital', studio: 'G.A.W.Studio', general: 'General' } as const;

export type Topic = keyof typeof TOPICS;

/** The page that holds the form. */
export const SOURCES = ['contact'] as const;

export interface Submission extends Sender<(typeof SOURCES)[number]> {
  topic: Topic;
}

/** The posted form, validated: `undefined` when any field is missing or malformed. */
export function readSubmission(data: FormData): Submission | undefined {
  const sender = readSender(data, SOURCES);
  const topic = field(data, 'topic');
  if (!sender || !has(TOPICS, topic)) return undefined;
  return { ...sender, topic };
}

/** The message as it is delivered: the topic leads the subject, so the mailbox can sort by it. */
export function compose(s: Submission): Mail {
  return {
    subject: `[gawgroup.cz] ${TOPICS[s.topic]}`,
    replyTo: s.email,
    text: [
      `From: ${s.email}`,
      `Topic: ${TOPICS[s.topic]}`,
      `Page: ${pathOf(`/${s.source}`, s.locale)} (${s.locale})`,
      '',
      s.message,
      '',
    ].join('\n'),
  };
}
