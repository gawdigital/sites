import { defineField, defineType, type StringRule } from 'sanity';

// The sites' locales. English is the approved copy and required; German and Czech fall back to it while empty.
const LOCALES = [
  { name: 'en', title: 'English' },
  { name: 'de', title: 'German' },
  { name: 'cs', title: 'Czech' },
];

const required = (locale: string) => <R extends StringRule>(rule: R) => (locale === 'en' ? rule.required() : rule);

export const localeString = defineType({
  name: 'localeString',
  title: 'Localized string',
  type: 'object',
  fields: LOCALES.map(({ name, title }) => defineField({ name, title, type: 'string', validation: required(name) })),
});

export const localeText = defineType({
  name: 'localeText',
  title: 'Localized text',
  type: 'object',
  fields: LOCALES.map(({ name, title }) => defineField({ name, title, type: 'text', rows: 3, validation: required(name) })),
});
