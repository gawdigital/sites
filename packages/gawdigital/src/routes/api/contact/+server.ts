// The contact form's endpoint: the sites' shared one (`@gaw/contact/endpoint.ts`), given this site's form and secrets.
import { MAIL_TO, SMTP_HOST, SMTP_PASSWORD, SMTP_USER, TURNSTILE_SECRET_KEY } from '$app/env/private';
import { contactEndpoint, contactRedirect } from '@gaw/contact/endpoint.ts';
import type { RequestHandler } from './$types';

import { SOURCES, compose, readSubmission } from '#lib/server/contact.ts';

export const prerender = false;

export const POST: RequestHandler = contactEndpoint({
  sources: SOURCES,
  read: readSubmission,
  compose,
  secrets: () => ({ TURNSTILE_SECRET_KEY, SMTP_HOST, SMTP_USER, SMTP_PASSWORD, MAIL_TO }),
});

export const GET: RequestHandler = contactRedirect;
