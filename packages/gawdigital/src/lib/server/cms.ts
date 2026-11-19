import { SANITY_DATASET, SANITY_PROJECT_ID } from '$app/env/private';

import { type Content, fetchContent } from '#lib/cms.ts';

let content: Promise<Content | undefined> | undefined;

/** The CMS content, read once per build; `undefined` where no project is configured, so the pages use their fallback. */
export const cmsContent = (): Promise<Content | undefined> =>
  (content ??= SANITY_PROJECT_ID ? fetchContent(SANITY_PROJECT_ID, SANITY_DATASET) : Promise.resolve(undefined));
