import { defineType } from 'sanity'

export default defineType({
  name: 'stat',
  title: 'Статистика',
  type: 'document',
  fields: [
    { name: 'value', title: 'Значение', type: 'string', validation: (Rule) => Rule.required() },
    { name: 'label', title: 'Подпись', type: 'string', validation: (Rule) => Rule.required() },
    { name: 'order', title: 'Порядок', type: 'number', validation: (Rule) => Rule.required() },
  ],
  orderings: [
    {
      title: 'Порядок',
      name: 'orderAsc',
      by: [{ field: 'order', direction: 'asc' }],
    },
  ],
})
