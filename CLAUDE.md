# sites

Bun workspace with the G.A.W.Digital websites. `packages/gawdigital` is gawdigital.cz (SvelteKit 3, Svelte 5,
adapter-cloudflare on Workers); `common/ui` holds the shared components and theme, `common/i18n` the locale routing
and `hreflang` helper. See `README.md` for the routes, the contact form and the owner steps.

## Commands

`bun install` · `bun run dev` · `bun run build` · `bun run check` · `bun run test` · `bunx --bun wrangler …` (from
`packages/gawdigital`). Bun only: no npm, pnpm or yarn files, no `package-lock.json`. Tools run with `bun --bun`
so Bun, not Node, executes them; `serve` (`wrangler dev`) alone needs Node, since it cannot run under Bun.

## Rules

- **No e-mail address of ours, and no SMTP address, anywhere on the site or in the repository.** Placeholders such as
  `name@example.com` are fine.
- **Secrets live only in Cloudflare** (`wrangler secret put`; `.dev.vars` locally, never committed):
  `TURNSTILE_SECRET_KEY`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_TO`.
- Every change goes through a pull request; CI checks, tests and builds it and uploads a preview. `main` deploys.
- Commit message prefix = the area: `gawdigital:`, `common:`, `ci:`, `docs:`.
- English for every committed artifact. All page copy lives in the translation files (`en` is the approved
  design copy; `de` and `cs` are drafts awaiting review).
- Pages are prerendered with `csr = false`; behaviour comes from small inline scripts and must work without
  JavaScript (Turnstile excepted). `/api/contact` is the only server route.
- English paths in every locale: `/de/contact`, never `/de/kontakt`. English is unprefixed.
- `src/params.ts` is loaded by the runtime directly: it must not import anything that pulls in CSS.
