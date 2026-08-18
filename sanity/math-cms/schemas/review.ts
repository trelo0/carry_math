import { defineField, defineType } from 'sanity'

export default defineType({
  name: 'review',
  title: 'Отзыв (главная страница)',
  type: 'document',
  fields: [
    defineField({
      name: 'name',
      title: 'Автор',
      description: 'Например: Анастасия К.',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'result',
      title: 'Результат',
      description: 'Например: 87 баллов ЦТ',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'text',
      title: 'Текст отзыва',
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
      title: 'name',
      subtitle: 'result',
    },
  },
})
