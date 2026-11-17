// Kept apart from `site.ts`: the route param matcher imports this, and the build loads that matcher with Node
// itself, which cannot import the stylesheets `site.ts` pulls in.

/** The contact form's outcomes, each a prerendered page the form's endpoint sends a visitor without JavaScript to. */
export const FORM_STATES = ['sent', 'invalid', 'verification', 'rate', 'failed'] as const;

export type FormState = (typeof FORM_STATES)[number];

export const isFormState = (v: string): v is FormState => (FORM_STATES as readonly string[]).includes(v);
