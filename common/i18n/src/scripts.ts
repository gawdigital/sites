// The visitor's language, decided in the browser: two small plain scripts, inlined into the prerendered pages like
// the theme's. Without JavaScript nothing is redirected and the bare paths stay English.
//
// - `LANG_HEAD` goes first in the `<head>` of the unprefixed (English) pages only. A language chosen with the
//   CS · EN · DE switch (localStorage `lang`) wins; without one, the first of `navigator.languages` whose primary
//   subtag is one of the site's languages does. German or Czech replaces the page with its `/de` or `/cs` address,
//   query and hash kept, before it renders. Prefixed pages never redirect.
// - `LANG` goes on every page: a click on the switch stores the locale it leads to.
import choice from './scripts/choice.js?raw';
import redirect from './scripts/redirect.js?raw';

export const LANG_HEAD = redirect;
export const LANG = choice;
