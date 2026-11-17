import { defineParams } from '@sveltejs/kit/params';

import { isPrefixed } from '@gaw/i18n/locale.ts';

import { isFormState } from '#lib/forms.ts';

export const params = defineParams({
  // Only the prefixed locales: English has no segment at all, so accepting `en` would give every page two
  // addresses, and accepting anything would let the optional segment swallow `/contact`.
  locale: (param) => (isPrefixed(param) ? param : undefined),
  formstate: (param) => (isFormState(param) ? param : undefined),
});
