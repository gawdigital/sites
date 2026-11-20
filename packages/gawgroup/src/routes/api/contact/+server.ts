// The contact form's endpoint, the only server route: the shared one of `@gaw/contact`, with this site's form.
import { MAIL_TO, SMTP_HOST, SMTP_PASSWORD, SMTP_USER, TURNSTILE_SECRET_KEY } from '$app/env/private';
import { contactEndpoint, contactRedirect } from '@gaw/contact/endpoint.ts';

import { SOURCES, compose, readSubmission } from '#lib/server/contact.ts';

export const prerender = false;

export const POST = contactEndpoint({
  sources: SOURCES,
  read: readSubmission,
  compose,
  secrets: () => ({ TURNSTILE_SECRET_KEY, SMTP_HOST, SMTP_USER, SMTP_PASSWORD, MAIL_TO }),
});

export const GET = contactRedirect;
