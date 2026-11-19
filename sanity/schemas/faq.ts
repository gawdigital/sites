import { defineArrayMember, defineField, defineType } from 'sanity';

// A product's FAQ: groups of questions, each shown under its title, in the order given here. Plain text only.
export const faq = defineType({
  name: 'faq',
  title: 'FAQ',
  type: 'document',
  fields: [
    defineField({
      name: 'product',
      title: 'Product',
      type: 'reference',
      to: [{ type: 'product' }],
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'groups',
      title: 'Groups',
      type: 'array',
      of: [
        defineArrayMember({
          name: 'group',
          type: 'object',
          fields: [
            defineField({ name: 'title', title: 'Title', type: 'localeString', validation: (rule) => rule.required() }),
            defineField({
              name: 'items',
              title: 'Questions',
              type: 'array',
              of: [
                defineArrayMember({
                  name: 'item',
                  type: 'object',
                  fields: [
                    defineField({ name: 'question', title: 'Question', type: 'localeString', validation: (rule) => rule.required() }),
                    defineField({ name: 'answer', title: 'Answer', type: 'localeText', validation: (rule) => rule.required() }),
                  ],
                  preview: { select: { title: 'question.en' } },
                }),
              ],
            }),
          ],
          preview: { select: { title: 'title.en' } },
        }),
      ],
    }),
  ],
  preview: { select: { title: 'product.name.en' }, prepare: ({ title }) => ({ title: `FAQ · ${title ?? '—'}` }) },
});
