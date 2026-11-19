import { cmsContent } from '#lib/server/cms.ts';

// The CMS content for every page, fetched once per build (see `#lib/server/cms.ts`).
export const load = async () => ({ cms: await cmsContent() });
