# sites

Bun workspace with the G.A.W. websites, one Cloudflare Worker each (SvelteKit 3, Svelte 5, adapter-cloudflare):
`packages/gawdigital` is gawdigital.cz, `packages/gawgroup` is gawgroup.cz, `packages/gawstudio` is gawstudio.cz (its
own design, pages and drawn forms so far, not deployed: issue #29). `common/ui` holds the shared components,
themes and form spec, `common/i18n` the locale routing and `hreflang` helper, `common/contact` the contact endpoint,
`common/company` the company details and brand list, `sanity/` the content studio (gawdigital's products and FAQ, read
at build time). See `README.md` for the routes, the contact form and the owner steps.

## Commands

`bun install` · `bun run dev` · `bun run build` · `bun run check` · `bun run test` · `bunx --bun wrangler …` (from
the site's package). Bun only: no npm, pnpm or yarn files, no `package-lock.json`. Tools run with `bun --bun`
so Bun, not Node, executes them; `serve` (`wrangler dev`) alone needs Node, since it cannot run under Bun.

## Rules

- **No e-mail address of ours, and no SMTP address, anywhere on the site or in the repository.** Placeholders such as
  `name@example.com` are fine.
- **Secrets live only in Cloudflare**, on each site's Worker (`wrangler secret put`, or `wrangler versions secret put`
  while the latest version is an undeployed preview; `.dev.vars` locally, never committed): `TURNSTILE_SECRET_KEY`,
  `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_TO`.
- Each site's Turnstile widget lists its production domain only, so previews cannot send mail (they carry the
  production secrets). Do not add `workers.dev` or other test hostnames to a widget.
- Every change goes through a pull request; CI checks, tests and builds it and uploads a preview. `main` deploys
  both sites.
- Commit message prefix = the area: `gawdigital:`, `gawgroup:`, `gawstudio:`, `common:`, `sanity:`, `ci:`, `docs:`.
- English for every committed artifact. All page copy lives in the translation files (`en` is the approved
  design copy; `de` and `cs` are AI-checked, awaiting a native speaker's review), except gawdigital's products and FAQ, which come from Sanity
  and fall back to those files.
- The Sanity project ID, dataset and tokens never go into the repository (GitHub variables, `sanity/.env`).
- Pages are prerendered with `csr = false`; behaviour comes from small inline scripts and must work without
  JavaScript (Turnstile excepted). `/api/contact` is the only server route.
- English paths in every locale: `/de/contact`, never `/de/kontakt`. English is unprefixed.
- `src/params.ts` is loaded by the runtime directly: it must not import anything that pulls in CSS.
- The language redirect is an inline script in the `<head>` of the English pages (`common/i18n/src/scripts`); the
  switch's choice is kept in localStorage `lang`, like the theme. No cookie, no Worker of our own, no language bar.
