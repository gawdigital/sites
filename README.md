# sites

The websites of the G.A.W. brands, one Bun workspace. It holds **gawdigital.cz** and **gawgroup.cz**, each built with
SvelteKit and deployed to its own Cloudflare Worker, and **gawstudio.cz**, which is being built (issue #29).

| Path | What it is |
|------|------------|
| `packages/gawdigital` | The gawdigital.cz site (SvelteKit 3, Svelte 5, `@sveltejs/adapter-cloudflare`) |
| `packages/gawgroup` | The gawgroup.cz site, the same stack and conventions |
| `packages/gawstudio` | The gawstudio.cz site: the same stack, its own design; pages only so far, not deployed |
| `common/company` | What every site says about the company: its registered details and the list of brands, as data |
| `common/contact` | The contact form's server side: reading and validating a post, Turnstile, the rate limit, SMTP delivery; a site adds its own fields and message |
| `common/ui` | Shared components (header, footer, mobile menu, language switch, hatch), the themes (the default one and the group's gold one, `styles/gawgroup.css`) and their inline scripts, and the form spec: the fields, pills, verification box and form cards with their styles and scripts, in each site's colours |
| `common/i18n` | Locale routing (English unprefixed, `/de` and `/cs` prefixed), `hreflang` alternates, the language redirect's inline scripts |
| `sanity/` | The Sanity content studio: the products and the FAQ (see its README) |

## Commands

Bun 1.4.4 is the runtime and package manager (`bun install` writes `bun.lock`, which is committed). The scripts
run Vite, svelte-check and Wrangler with `bun --bun`, so Bun executes them rather than the Node their bin files
name; the one exception is `serve`, because `wrangler dev` cannot forward requests to the Worker under Bun
(oven-sh/bun#39247) and runs on Node. In production the site runs on Cloudflare Workers, not on Bun or Node.

| Command | Purpose |
|---------|---------|
| `bun install` | Install the workspace |
| `bun run dev` | Develop gawdigital.cz with Vite |
| `bun run --filter gawdigital dev:https` | The same over HTTPS on the local network (self-signed certificate), e.g. to try it on a phone |
| `bun run dev:gawgroup` | Develop gawgroup.cz with Vite |
| `bun run dev:gawstudio` | Develop gawstudio.cz with Vite |
| `bun run build` | Build every site for Cloudflare (`packages/<site>/.svelte-kit/cloudflare`) |
| `bun run check` | Type-check (svelte-check) |
| `bun run test` | Unit tests (`bun test`: the contact form's validation, locale routing, the language redirect's scripts, the CMS reads) |
| `bun run --filter studio dev` | Run the Sanity studio locally (`sanity/README.md`) |
| `bun run --filter gawdigital serve` | Serve the build locally with `wrangler dev` (bindings included; needs Node) |
| `bunx --bun wrangler …` | Any other Wrangler command, from the site's package |

## gawdigital.cz

Every page is prerendered and ships no client framework (`csr = false`); the small inline scripts only add the
language redirect, the theme switch, the mobile menu, copy buttons, the form's in-page submit and the desktop
layout's scale. Everything works without JavaScript except Turnstile.

The desktop layout is drawn 1440 px wide. Up to 768 px the phone layout shows; between that and 1440 px the desktop
frame is scaled to the window by a transform (`common/ui/src/scripts/fit-head.js`), and without JavaScript by a
ladder of `zoom` steps (`common/ui/src/styles.ts`). The transform is the one to rely on: WebKit keeps zoomed text
at 9 px or more while the layout around it goes on shrinking.

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
its folder, except what the CMS holds (below). English is the approved design copy. The German and Czech texts have been checked by AI; **a native speaker's review is
still pending**, the privacy policy most of all. Company data is not translated.

### CMS

The products (name and summary) and the MIDI Control FAQ come from Sanity, read **once per build** with a GROQ query
against the public dataset (`src/lib/cms.ts`, loaded for every page by `src/routes/[[lang=locale]]/+layout.server.ts`).
A field the CMS leaves empty falls back to English, and content it does not hold at all to the translation files
(`src/lib/content.ts` names the keys), so a build without `SANITY_PROJECT_ID` renders the same pages as before. A
failed read fails the build rather than deploying the fallback over published content. The pages are prerendered,
so a publish reaches the site by redeploying it: the studio's webhook starts `deploy.yml` (`repository_dispatch`,
type `sanity-publish`).

| Name | Kind | Purpose |
|------|------|---------|
| `SANITY_PROJECT_ID` | build variable | The Sanity project (a GitHub repository variable); unset, the CMS is not read |
| `SANITY_DATASET` | build variable | Its dataset, `production` by default |

### Contact form

The form posts to `/api/contact`, which validates the fields, applies the rate limit, verifies Turnstile and sends the
message by SMTP (worker-mailer, port 587, STARTTLS), falling back to Cloudflare's `send_email`
binding. A plain form post is answered with a 303 to the form's result page; the inline script asks for JSON and
stays on the page. The visitor's address is the Reply-To; From is the SMTP account.

**No address of ours appears in this repository or on the site**, the SMTP server's included. Every address and
credential is a Cloudflare secret:

| Name | Kind | Purpose |
|------|------|---------|
| `TURNSTILE_SECRET_KEY` | secret | Turnstile secret key; without it every submission fails verification |
| `SMTP_HOST` | secret | The SMTP server; without it only the `send_email` fallback is tried |
| `SMTP_USER` | secret | SMTP login, and the From address |
| `SMTP_PASSWORD` | secret | SMTP password; without it only the `send_email` fallback is tried |
| `MAIL_TO` | secret | Where messages are delivered |
| `PUBLIC_TURNSTILE_SITE_KEY` | build variable | Turnstile site key, inlined at build time (a GitHub repository variable in CI); defaults to Cloudflare's test key |
| `CONTACT_LIMITER` | binding | Workers Rate Limiting, 5 messages a minute per IP (`wrangler.jsonc`) |
| `SEND_EMAIL` | binding | `send_email`, the fallback sender (`wrangler.jsonc`) |

Set the secrets with `bunx --bun wrangler secret put <NAME>` in `packages/gawdigital`. For `wrangler dev`, put them in
`packages/gawdigital/.dev.vars` (ignored by git), for example with Cloudflare's always-passing Turnstile test secret
`1x0000000000000000000000000000000AA`.

### CI and deployment

gawdigital and gawgroup are checked, tested, built and deployed by the same two workflows; gawstudio is checked,
tested and built, and gets a preview, but is not deployed yet.

- **Pull requests** (`.github/workflows/ci.yml`): install, check, test, build, then upload a preview version of each
  site with `bun --bun wrangler versions upload --preview-alias pr-<number>`; a comment on the pull request (updated
  on every push) and the step summary name the URLs. The uploads of gawgroup and gawstudio may fail without failing the run (the row in
  the comment then says so).
- **`main`** (`.github/workflows/deploy.yml`): the same checks, then `bun run deploy` (`bun --bun wrangler deploy`)
  for gawdigital and after it for gawgroup, so a failure of the second leaves the first deployed.
  A publish in the Sanity studio runs it too (`repository_dispatch`), so the site is rebuilt with the new content.
- Pull requests also build the Sanity studio, which catches a schema it cannot load.

In both, `node` on the runner's PATH is a link to Bun, so install scripts run on Bun too.
Both need the repository secrets `CLOUDFLARE_API_TOKEN` (Workers edit rights) and `CLOUDFLARE_ACCOUNT_ID`.

### Owner steps (gawdigital.cz)

1. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to the GitHub repository secrets, and
   `PUBLIC_TURNSTILE_SITE_KEY` to its variables.
2. Create a Turnstile widget for the domain; put its secret in `TURNSTILE_SECRET_KEY`.
3. Put `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_TO` into the Worker's secrets.
4. For the `send_email` fallback: enable Email Routing on the sender's domain and verify the `MAIL_TO` address as a
   destination.
5. When the app is live, replace the `#app-store` placeholder links with its Mac App Store URL.
6. Set up the CMS: the repository variables, the seed, the studio and the publish webhook (`sanity/README.md`).
7. Have the German and Czech texts reviewed by a native speaker (so far they have had an AI check only).

## gawstudio.cz

The recording studio's site, planned in issue #29. So far it is the five pages of the design (home, recording, mix,
mastering, contact) and each service's form page (`/recording/book`, `/mix/order`, `/mastering/order`) in English,
German and Czech: prerendered, no client framework, and no script but the language ones, the phone's menu and the
fields' indicator. Booking, orders, payments and accounts come in the issue's later phases.

- **Design**: G.A.W.Studio's own, not the shared theme: one stylesheet (`src/lib/styles/site.css`) drawn from the
  1680 px design, every length a multiple of the design's pixel (`--px`) so the page scales with the window; one
  column on a phone, where the menu is the other sites' overlay behind three dots. The typeface, the language
  switch, that menu, the company's details and the forms' fields (the shared form spec, in the studio's colours:
  `src/lib/styles/form.css`) come from `common/`.
- **Copy**: `packages/gawstudio/src/lib/translations`. The design's body copy is placeholder text, so every
  description is provisional, in all three languages, until the owner approves it.
- **Not wired yet**: the booking and order forms are only drawn (their button is disabled and a note leads to the
  contact page); the offer's card leads to the contact page, whose "Write to us" card opens gawgroup.cz's contact
  form with the studio's topic; the cart, the account and the sound sample's player are only drawn.
- **Not launched**: the Worker has no route (gawstudio.cz still serves the old site) and is not in the deploy
  workflow; every page carries `noindex` until `LAUNCHED` in `src/lib/site.ts` is turned on. CI uploads a preview
  version once the Worker `gawstudio` exists (an owner step: one `bun run deploy` in `packages/gawstudio`, which
  publishes it on workers.dev only).

## gawgroup.cz

The group's own site: what G.A.W.Group is, its brands with links to their sites, and the company's contact. It
follows gawdigital.cz in everything above (prerendered, `csr = false`, the language redirect and switch, the theme
switch, the desktop frame's scale, English paths in every locale, `hreflang`, a translated 404); only its theme,
pages and copy are its own.

| Route | Page |
|-------|------|
| `/` | Home: the claim, the brands, who we are, and a card that opens the contact form with a topic chosen |
| `/contact` | Contact form and company details (`/contact?topic=studio` preselects the topic) |
| `/privacy` | Privacy policy |
| `/contact/{sent,invalid,verification,rate,failed}` | The form's result pages, `noindex` |
| `/api/contact` | The contact form endpoint (`POST`, the only route not prerendered) |

- **Shared with gawdigital.cz**: the company's details and the brand list (`common/company`), the contact endpoint
  (`common/contact`), the header, footer, menus, form spec, company rows, copy buttons, dividers, brand cards and
  hatched pills (`common/ui`). The gold theme is `common/ui/src/styles/gawgroup.css`, applied over the shared base.
- **Copy**: `packages/gawgroup/src/lib/translations`, as on gawdigital.cz; nothing comes from the CMS. English is the
  approved design copy. German and Czech have been checked by AI and await a native speaker's review. The Czech
  home page claim ("HRAJ A BUDE TI HRÁNO.") is **provisional**: it is still open in issue #22.
- **Contact form**: the form asks for an address, a topic (Digital, Studio or General) and a message; the topic
  leads the mail's subject (`[gawgroup.cz] G.A.W.Studio`). The endpoint, its secrets and its bindings are the ones
  described for gawdigital.cz, set on the Worker `gawgroup` (`bunx --bun wrangler secret put <NAME>` in
  `packages/gawgroup`, `.dev.vars` locally). Its rate limit has its own namespace.
- **Turnstile**: gawgroup.cz has its own widget. Its public site key is the default of
  `PUBLIC_GAWGROUP_TURNSTILE_SITE_KEY` in `packages/gawgroup/src/env.ts` (a site key is printed in every page, so it
  is not a secret); the name differs from gawdigital's variable so one build of the workspace cannot mix them up. For
  a local build set Cloudflare's always-passing test key `1x00000000000000000000AA` in `packages/gawgroup/.env`.
  The widget only runs on the hostnames it is configured for, gawgroup.cz alone, so on a preview URL the form shows
  the widget's error. That is deliberate: a preview carries the production secrets, and no test build may send mail
  to our mailbox.

### Owner steps (gawgroup.cz)

1. The Worker `gawgroup` and the Turnstile widget exist, and `TURNSTILE_SECRET_KEY` is set. Put `SMTP_HOST`,
   `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_TO` into the Worker's secrets.
2. Make the zone gawgroup.cz active on Cloudflare (switch the domain's nameservers). Until then the deploy of
   gawgroup on `main` fails at attaching `gawgroup.cz` and `www.gawgroup.cz`; gawdigital is deployed before it and is
   not affected. Keep the zone's mail records (MX, SPF, DKIM, DMARC) when moving it.
3. For the `send_email` fallback: enable Email Routing on the sender's domain and verify the `MAIL_TO` address as a
   destination.
4. Decide the Czech claim (issue #22) and have the German and Czech texts reviewed by a native speaker.
