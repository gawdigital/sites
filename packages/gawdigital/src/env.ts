import { defineEnvVars } from '@sveltejs/kit/env';

// The secrets live in Cloudflare only (`wrangler secret put …`, or `.dev.vars` locally, never committed). Each is
// optional here so a build or a preview without them still starts: the contact endpoint answers `failed` instead.
const optional = (value: string | undefined) => value || undefined;

export const variables = defineEnvVars({
  PUBLIC_TURNSTILE_SITE_KEY: {
    public: true,
    static: true,
    // Cloudflare's documented always-passing test key, so a local build renders a working widget.
    schema: (value) => value || '1x00000000000000000000AA',
    description: 'Turnstile site key of the contact form (a build-time variable, not a secret).',
  },
  TURNSTILE_SECRET_KEY: { schema: optional, description: 'Turnstile secret key, verified server-side.' },
  SMTP_HOST: { schema: optional, description: 'SMTP server (port 587, STARTTLS).' },
  SMTP_USER: { schema: optional, description: 'SMTP login; also the sender address.' },
  SMTP_PASSWORD: { schema: optional, description: 'SMTP password.' },
  MAIL_TO: { schema: optional, description: 'Where contact form messages are delivered.' },
});
