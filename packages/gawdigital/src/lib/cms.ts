// Content from the Sanity CMS, read once per build: every page is prerendered, so a publish reaches the site through
// a fresh deploy (see README.md). Kept free of platform imports so it unit-tests under Bun.
import { FAQ_KEYS, PRODUCT_KEYS, type ProductSlug } from './content.ts';

export type Localized = { en?: string; de?: string; cs?: string };

export type Content = {
  products: { slug?: string; name?: Localized; summary?: Localized }[];
  faqs: { product?: string; groups?: { title?: Localized; items?: { question?: Localized; answer?: Localized }[] }[] }[];
};

export type Faq = { title: string; items: { question: string; answer: string }[] }[];

export type Product = { name: string; summary: string };

/** Published documents only: the dataset is public, and drafts never reach the site. */
export const QUERY = `{
  "products": *[_type == "product"] | order(order asc) { "slug": slug.current, name, summary },
  "faqs": *[_type == "faq"] { "product": product->slug.current, groups[] { title, items[] { question, answer } } }
}`;

export const API_VERSION = 'v2025-02-19';

/** The live API rather than the CDN, so a deploy that a publish set off never reads the content from before it. */
export const queryUrl = (projectId: string, dataset: string): string =>
  `https://${projectId}.api.sanity.io/${API_VERSION}/data/query/${dataset}?perspective=published&query=${encodeURIComponent(QUERY)}`;

/** A failed read fails the build: deploying the fallback copy over published content would undo a publish. */
export async function fetchContent(projectId: string, dataset: string, fetcher: typeof fetch = fetch): Promise<Content> {
  const response = await fetcher(queryUrl(projectId, dataset));
  if (!response.ok) throw new Error(`Sanity answered ${response.status} ${response.statusText}`);
  const { result } = (await response.json()) as { result?: Partial<Content> };
  return { products: result?.products ?? [], faqs: result?.faqs ?? [] };
}

/** The text in a locale, English where that locale is empty. */
export const pick = (value: Localized | undefined, locale: string): string =>
  value?.[locale as keyof Localized]?.trim() || value?.en?.trim() || '';

type Translate = (key: string) => string;

/** Translation strings may carry entities (`TRIAL &amp; PURCHASE`); the FAQ renders as plain text. */
const plain = (text: string) => text.replaceAll('&amp;', '&');

/** A product's FAQ: the CMS's where it holds a non-empty one, the translation files' otherwise. */
export function faqFor(content: Content | undefined, slug: ProductSlug, locale: string, t: Translate): Faq {
  const groups = content?.faqs.find((f) => f.product === slug)?.groups ?? [];
  const faq = groups
    .map((g) => ({
      title: pick(g.title, locale),
      items: (g.items ?? [])
        .map((i) => ({ question: pick(i.question, locale), answer: pick(i.answer, locale) }))
        .filter((i) => i.question && i.answer),
    }))
    .filter((g) => g.title && g.items.length);
  if (faq.length) return faq;
  return (FAQ_KEYS[slug] ?? []).map((g) => ({
    title: plain(t(g.title)),
    items: g.items.map(([q, a]) => ({ question: plain(t(q)), answer: plain(t(a)) })),
  }));
}

/** A product's name and summary, each from the CMS where it is set there, from the translation files otherwise. */
export function productFor(content: Content | undefined, slug: ProductSlug, locale: string, t: Translate): Product {
  const found = content?.products.find((p) => p.slug === slug);
  const keys = PRODUCT_KEYS[slug];
  return {
    name: pick(found?.name, locale) || plain(t(keys.name)),
    summary: pick(found?.summary, locale) || plain(t(keys.summary)),
  };
}
