// Starts the CMS off with the copy the site ships today: the products and the FAQ of the translation files.
// Run from `sanity/` with `bun run seed` (after `bunx sanity login`). It replaces the seeded documents whole, so
// run it once, before anyone edits in the studio.
import { getCliClient } from 'sanity/cli';

import { FAQ_KEYS, PRODUCT_KEYS, type ProductSlug } from '../../packages/gawdigital/src/lib/content.ts';

const LOCALES = ['en', 'de', 'cs'] as const;
const ROOT = new URL('../../packages/gawdigital/src/lib/translations/', import.meta.url);

type Strings = Record<string, unknown>;
const read = async (path: string): Promise<Strings> => Bun.file(new URL(path, ROOT)).json();

const strings = Object.fromEntries(
  await Promise.all(
    LOCALES.map(async (locale) => [
      locale,
      { base: await read(`${locale}.json`), support: await read(`support/${locale}.json`), midisupport: await read(`midisupport/${locale}.json`) },
    ]),
  ),
) as Record<(typeof LOCALES)[number], { base: Strings; support: Strings; midisupport: Strings }>;

/** A translation key in every locale: `common.x` from the base file, `support.x` / `midisupport.x` from their own. */
const localized = (key: string) => {
  const [namespace, name] = key.split('.') as [string, string];
  return Object.fromEntries(
    LOCALES.map((locale) => {
      const file = strings[locale];
      const value = namespace === 'support' || namespace === 'midisupport' ? file[namespace][name] : (file.base[namespace] as Strings)?.[name];
      if (typeof value !== 'string') throw new Error(`${locale}: ${key} is missing`);
      return [locale, value.replaceAll('&amp;', '&').replace(/\s*\n\s*/g, ' ')];
    }),
  );
};

// No dot in an ID: Sanity keeps such documents private, and the site reads the dataset without a token.
const docs: { _id: string; _type: string; [field: string]: unknown }[] = [];

(Object.keys(PRODUCT_KEYS) as ProductSlug[]).forEach((slug, order) => {
  const keys = PRODUCT_KEYS[slug];
  docs.push({
    _id: `product-${slug}`,
    _type: 'product',
    slug: { _type: 'slug', current: slug },
    name: { _type: 'localeString', ...localized(keys.name) },
    summary: { _type: 'localeText', ...localized(keys.summary) },
    order,
  });
});

for (const [slug, groups] of Object.entries(FAQ_KEYS)) {
  docs.push({
    _id: `faq-${slug}`,
    _type: 'faq',
    product: { _type: 'reference', _ref: `product-${slug}` },
    groups: groups.map((group) => ({
      _key: group.title.split('.')[1],
      _type: 'group',
      title: { _type: 'localeString', ...localized(group.title) },
      items: group.items.map(([question, answer]) => ({
        _key: question.split('.')[1],
        _type: 'item',
        question: { _type: 'localeString', ...localized(question) },
        answer: { _type: 'localeText', ...localized(answer) },
      })),
    })),
  });
}

// `SEED_DRY_RUN=1 bun scripts/seed.ts` prints the documents instead of writing them.
if (process.env.SEED_DRY_RUN) {
  console.log(JSON.stringify(docs, null, 2));
  process.exit(0);
}

const client = getCliClient({ apiVersion: '2025-02-19' });
const tx = client.transaction();
for (const doc of docs) tx.createOrReplace(doc);
const result = await tx.commit();
console.log(`Seeded ${result.documentIds.length} documents: ${result.documentIds.join(', ')}`);
