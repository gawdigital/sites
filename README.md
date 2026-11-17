# sites

The websites of G.A.W.Digital, one Bun workspace. Today it holds one site, **gawdigital.cz**, built with
SvelteKit and deployed to Cloudflare Workers.

| Path | What it is |
|------|------------|
| `packages/gawdigital` | The gawdigital.cz site (SvelteKit 3, Svelte 5, `@sveltejs/adapter-cloudflare`) |
| `common/ui` | Shared components (header, footer, mobile menu, language switch, hatch), the theme and its inline scripts |
| `common/i18n` | Locale routing (English unprefixed, `/de` and `/cs` prefixed), `hreflang` alternates, the language redirect's inline scripts |
| `sanity/` | Placeholder for the Sanity content studio (see its README) |

## Commands

Bun 1.4.4 is the runtime and package manager (`bun install` writes `bun.lock`, which is committed). The scripts
run Vite, svelte-check and Wrangler with `bun --bun`, so Bun executes them rather than the Node their bin files
name; the one exception is `serve`, because `wrangler dev` cannot forward requests to the Worker under Bun
(oven-sh/bun#39247) and runs on Node. In production the site runs on Cloudflare Workers, not on Bun or Node.

| Command | Purpose |
|---------|---------|
| `bun install` | Install the workspace |
| `bun run dev` | Develop gawdigital.cz with Vite |
| `bun run build` | Build it for Cloudflare (`packages/gawdigital/.svelte-kit/cloudflare`) |
| `bun run check` | Type-check (svelte-check) |
| `bun run test` | Unit tests (`bun test`: the contact form's validation, locale routing, the language redirect's scripts) |
| `bun run --filter gawdigital serve` | Serve the build locally with `wrangler dev` (bindings included; needs Node) |
| `bunx --bun wrangler …` | Any other Wrangler command, from `packages/gawdigital` |

## gawdigital.cz

Every page is prerendered and ships no client framework (`csr = false`); the small inline scripts only add the
language redirect, the theme switch, the mobile menu, copy buttons and the form's in-page submit. Everything works
without JavaScript except Turnstile.

| Route | Page |
|-------|------|
| `/` | Home |
| `/apps/midi-control` | MIDI Control for Fireface |
| `/apps/midi-control/support` | Its support page and FAQ |
| `/support` | Support (`/support?product=midi-control#contact` preselects the product) |
| `/contact` | Contact and company details |
| `/privacy` | Privacy policy |
| `/support/{sent,invalid,verification,rate,failed}`, `/contact/…` | The form's result pages, `noindex` |
| `/api/contact` | The contact form endpoint (`POST`, the only route not prerendered) |

Each page exists in English at the bare path and in German and Czech under `/de` and `/cs`, with the same English
path segments. Pages carry `<html lang>`, a canonical link and `hreflang` alternates with `x-default`; the CS · EN · DE
switch links to the same page in the other locale. Unknown paths get a translated 404.

### Language

An inline script decides the language in the browser, before the page renders (`common/i18n/src/scripts`):

- On an unprefixed (English) page, a language chosen with the CS · EN · DE switch wins: a click on the switch stores
  its locale in localStorage `lang`, like the theme. Without one, the first of `navigator.languages` (or
  `navigator.language`) whose primary subtag is English, German or Czech decides. German or Czech replaces the page
  with the same page under `/de` or `/cs`, query and hash kept; anything else stays English.
- Prefixed pages never redirect. Without JavaScript nothing redirects and the bare paths stay English; crawlers
  follow the `hreflang` alternates.

Permanent (301) redirects from the old paths, also under `/de` and `/cs`:
`/midi-control` → `/apps/midi-control`, `/midi-control/support` → `/apps/midi-control/support`,
`/midi-control/privacy` → `/privacy`.

### Translations

All copy lives in `packages/gawdigital/src/lib/translations`: the shared strings in `{en,de,cs}.json`, each page's in
its folder. English is the approved design copy. **The German and Czech texts are drafts awaiting review by a
native speaker**, the privacy policy most of all. Company data is not translated.

### Contact form

The form posts to `/api/contact`, which validates the fields, applies the rate limit, verifies Turnstile and sends the
message by SMTP (worker-mailer, `mail.blueboard.cz:587`, STARTTLS), falling back to Cloudflare's `send_email`
binding. A plain form post is answered with a 303 to the form's result page; the inline script asks for JSON and
stays on the page. The visitor's address is the Reply-To; From is the SMTP account.

**No address of ours appears in this repository or on the site.** Every address and credential is a Cloudflare
secret:

| Name | Kind | Purpose |
|------|------|---------|
| `TURNSTILE_SECRET_KEY` | secret | Turnstile secret key; without it every submission fails verification |
| `SMTP_USER` | secret | SMTP login at mail.blueboard.cz, and the From address |
| `SMTP_PASSWORD` | secret | SMTP password; without it only the `send_email` fallback is tried |
| `MAIL_TO` | secret | Where messages are delivered |
| `PUBLIC_TURNSTILE_SITE_KEY` | build variable | Turnstile site key, inlined at build time (a GitHub repository variable in CI); defaults to Cloudflare's test key |
| `CONTACT_LIMITER` | binding | Workers Rate Limiting, 5 messages a minute per IP (`wrangler.jsonc`) |
| `SEND_EMAIL` | binding | `send_email`, the fallback sender (`wrangler.jsonc`) |

Set the secrets with `bunx --bun wrangler secret put <NAME>` in `packages/gawdigital`. For `wrangler dev`, put them in
`packages/gawdigital/.dev.vars` (ignored by git), for example with Cloudflare's always-passing Turnstile test secret
`1x0000000000000000000000000000000AA`.

### CI and deployment

- **Pull requests** (`.github/workflows/ci.yml`): install, check, test, build, then upload a preview version with
  `bun --bun wrangler versions upload --preview-alias pr-<number>`; the step summary names its URL.
- **`main`** (`.github/workflows/deploy.yml`): the same checks, then `bun run deploy` (`bun --bun wrangler deploy`).

In both, `node` on the runner's PATH is a link to Bun, so install scripts run on Bun too.
Both need the repository secrets `CLOUDFLARE_API_TOKEN` (Workers edit rights) and `CLOUDFLARE_ACCOUNT_ID`.

### Owner steps

1. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to the GitHub repository secrets, and
   `PUBLIC_TURNSTILE_SITE_KEY` to its variables.
2. Create a Turnstile widget for the domain; put its secret in `TURNSTILE_SECRET_KEY`.
3. Put `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_TO` into the Worker's secrets.
4. For the `send_email` fallback: enable Email Routing on the sender's domain and verify the `MAIL_TO` address as a
   destination.
5. Once the zone is on Cloudflare, uncomment the custom-domain routes in `packages/gawdigital/wrangler.jsonc`.
6. When the app is live, replace the `#app-store` placeholder links with its Mac App Store URL.
7. Create the Sanity project (see `sanity/README.md`).
8. Have the German and Czech drafts reviewed.
