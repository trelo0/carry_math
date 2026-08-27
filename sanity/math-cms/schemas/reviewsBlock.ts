import { defineField, defineType } from 'sanity'

export default defineType({
  name: 'reviewsBlock',
  title: 'Курс — Отзывы (заголовок секции)',
  description:
    'Сами отзывы создаются отдельными документами типа «Отзыв (главная страница)».',
  type: 'document',
  fields: [
    defineField({
      name: 'sectionTitle',
      title: 'Заголовок секции',
      type: 'string',
      initialValue: 'Отзывы',
    }),
  ],
  preview: {
    select: { title: 'sectionTitle' },
  },
})
