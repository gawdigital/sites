import type { Content } from '#lib/cms.ts';

declare global {
  namespace App {
    interface PageData {
      /** The CMS content, `undefined` where no project is configured (see `#lib/server/cms.ts`). */
      cms?: Content;
    }
  }
}

export {};
