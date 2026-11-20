import { defineEnvVars } from '@sveltejs/kit/env';

// The secrets live in Cloudflare only (`wrangler secret put …`, or `.dev.vars` locally, never committed). Each is
// optional here so a build or a preview without them still starts: the contact endpoint answers `failed` instead.
const optional = (value: string | undefined) => value || undefined;

export const variables = defineEnvVars({
  PUBLIC_GAWGROUP_TURNSTILE_SITE_KEY: {
    public: true,
    static: true,
    // The site key of gawgroup.cz's own Turnstile widget (a widget is bound to its hostnames). It is public, printed
    // in every page, so it is kept here rather than in a GitHub variable; its name differs from gawdigital's so one
    // build of the workspace cannot hand a site the other's key. Elsewhere than on the widget's hostnames (a local
    // build), set Cloudflare's always-passing test key, 1x00000000000000000000AA, in `.env`.
    schema: (value) => value || '0x4AAAAAAGJwyxHwcAahbOyS',
    description: 'Turnstile site key of the contact form (a build-time variable, not a secret).',
  },
  TURNSTILE_SECRET_KEY: { schema: optional, description: 'Turnstile secret key, verified server-side.' },
  SMTP_USER: { schema: optional, description: 'SMTP login; also the sender address.' },
  SMTP_PASSWORD: { schema: optional, description: 'SMTP password.' },
  MAIL_TO: { schema: optional, description: 'Where contact form messages are delivered.' },
});
