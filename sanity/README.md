# Sanity

The content studio of the sites. It holds what the owner edits without a pull request: the **products** (name and
summary, in English, German and Czech) and the **FAQ** of MIDI Control for Fireface. Everything else stays in the
translation files (`packages/gawdigital/src/lib/translations`). The site reads the CMS at build time and falls back
to those files wherever the CMS holds nothing (the root README, *CMS*).

| Path | What it is |
|------|------------|
| `schemas/` | `product`, `faq` and the localized string / text objects (English required, German and Czech fall back to it) |
| `scripts/seed.ts` | Copies today's products and FAQ from the translation files into the dataset |
| `sanity.config.ts`, `sanity.cli.ts` | The studio and the CLI, reading the project from the environment |

Run everything from this folder. **The project ID, the dataset and every token stay out of the repository**: the
studio reads them from `sanity/.env` (ignored by git), the site's build from the GitHub repository variables.

```sh
# sanity/.env
SANITY_STUDIO_PROJECT_ID=<project id>
SANITY_STUDIO_DATASET=production
```

| Command | Purpose |
|---------|---------|
| `bun run dev` | The studio at `http://localhost:3333` |
| `bun run build` | Build it (CI does, to catch a broken schema) |
| `bun run deploy` | Deploy it to `<name>.sanity.studio` (asks for the name the first time) |
| `bun run seed` | Seed the dataset from the translation files (`SEED_DRY_RUN=1 bun scripts/seed.ts` only prints the documents) |

Document IDs carry no dot (`product-games`, `faq-midi-control`): Sanity keeps documents with a dot in their ID
private, and the site reads the public dataset without a token. Only published documents reach the site.

## Owner steps

1. Keep the dataset `production` **public** (the default): the site reads it without a token.
2. In the GitHub repository's variables, set `SANITY_PROJECT_ID` to the project ID and `SANITY_DATASET` to
   `production`.
3. Create `sanity/.env` as above, then `bunx sanity login` and `bun run seed`. Seed once, before editing in the
   studio: it replaces the seeded documents whole.
4. `bun run deploy` to put the studio online, and add its URL in sanity.io/manage → API → CORS origins if the CLI
   does not.
5. The publish webhook, so a publish redeploys the site:
   - In GitHub, create a fine-grained personal access token for this repository alone, with **Contents: read and
     write** (what the `dispatches` endpoint asks for). Keep it only in Sanity.
   - In sanity.io/manage → API → Webhooks, create one: URL
     `https://api.github.com/repos/<owner>/<repo>/dispatches`, dataset `production`, trigger on create, update
     and delete, filter `_type in ["product", "faq"]`, projection `{"event_type": "sanity-publish"}`, method
     `POST`, HTTP headers `Authorization: Bearer <token>` and `Accept: application/vnd.github+json`, drafts off.
