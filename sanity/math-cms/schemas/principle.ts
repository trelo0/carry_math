import { defineType } from 'sanity'

export default defineType({
  name: 'principle',
  title: 'Принцип',
  type: 'document',
  fields: [
    { name: 'title', title: 'Название', type: 'string', validation: (Rule) => Rule.required() },
    { name: 'description', title: 'Описание', type: 'text', validation: (Rule) => Rule.required() },
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
