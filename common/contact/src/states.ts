// Kept free of every other import: a site's route param matcher imports this, and the build loads that matcher with
// the runtime itself, which cannot import a stylesheet.

/** The contact form's outcomes, each a prerendered page the form's endpoint sends a visitor without JavaScript to. */
export const FORM_STATES = ['sent', 'invalid', 'verification', 'rate', 'failed'] as const;

export type FormState = (typeof FORM_STATES)[number];

export const isFormState = (v: string): v is FormState => (FORM_STATES as readonly string[]).includes(v);
