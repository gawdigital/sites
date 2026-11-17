// The pages' own inline scripts, kept verbatim from the approved design except for their few visible strings,
// which are filled in per locale.
import copy from './scripts/copy.js?raw';
import fields from './scripts/fields.js?raw';
import form from './scripts/form.js?raw';
import submit from './scripts/submit.js?raw';
import turnstile from './scripts/turnstile.js?raw';

const SOURCES = { copy, fields, form, submit, turnstile } as const;

export type ScriptName = keyof typeof SOURCES;

/** A value as a JavaScript literal that is safe inside a `<script>` element. */
const literal = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/** One `<script>` element, its `%NAME%` placeholders replaced by the given values. */
export function script(name: ScriptName, strings: Record<string, unknown> = {}): string {
  const source = SOURCES[name].trim().replace(/%([A-Z_]+)%/g, (whole, key: string) =>
    key in strings ? literal(strings[key]) : whole,
  );
  return `<script>${source}</script>`;
}
