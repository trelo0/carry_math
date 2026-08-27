import { defineField, defineType } from 'sanity'

export default defineType({
  name: 'faqItem',
  title: 'Вопрос FAQ (страница курса)',
  type: 'document',
  fields: [
    defineField({
      name: 'question',
      title: 'Вопрос',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'answer',
      title: 'Ответ',
      type: 'text',
      rows: 4,
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'order',
      title: 'Порядок вывода',
      type: 'number',
    }),
  ],
  preview: {
    select: {
      title: 'question',
    },
  },
})
