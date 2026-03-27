import { defineType } from 'sanity'

export default defineType({
  name: 'course',
  title: 'Курс',
  type: 'document',
  fields: [
    { name: 'title', title: 'Название', type: 'string' },
    { name: 'description', title: 'Описание', type: 'text' },
    { name: 'icon', title: 'Иконка', type: 'string' },
    { name: 'order', title: 'Порядок', type: 'number', validation: (Rule) => Rule.required() },
  ],
}) as any