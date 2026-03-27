import { defineType } from 'sanity'

export default defineType({
  name: 'methodStep',
  title: 'Шаг системы достижения',
  type: 'document',
  fields: [
    { name: 'title', title: 'Название', type: 'string' },
    { name: 'description', title: 'Описание', type: 'text' },
    { name: 'order', title: 'Порядок', type: 'number', validation: (Rule) => Rule.required() },
  ],
})