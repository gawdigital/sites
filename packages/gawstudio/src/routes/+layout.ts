// Every page is prerendered and ships without client-side rendering: the design's interactivity is a handful of
// small inline scripts. The contact endpoint opts out of prerendering on its own.
export const prerender = true;
export const csr = false;

export { load } from '#lib/translations/index.ts';
