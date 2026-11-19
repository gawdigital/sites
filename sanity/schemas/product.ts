import { defineField, defineType } from 'sanity';

// A product as the sites list it. Its art stays in the site's code, keyed by the slug.
export const product = defineType({
  name: 'product',
  title: 'Product',
  type: 'document',
  fields: [
    defineField({ name: 'name', title: 'Name', type: 'localeString', validation: (rule) => rule.required() }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      description: 'Ties the product to its art and pages in the site: midi-control, games.',
      options: { source: 'name.en' },
      validation: (rule) => rule.required(),
    }),
    defineField({ name: 'summary', title: 'Summary', type: 'localeText' }),
    defineField({ name: 'order', title: 'Order', type: 'number' }),
  ],
  orderings: [{ title: 'Order', name: 'order', by: [{ field: 'order', direction: 'asc' }] }],
  preview: { select: { title: 'name.en', subtitle: 'slug.current' } },
});
