import { defineField, defineType } from 'sanity'

export default defineType({
  name: 'faqBlock',
  title: 'Курс — FAQ (заголовок секции)',
  description:
    'Сами вопросы и ответы создаются отдельными документами типа «Вопрос FAQ (страница курса)».',
  type: 'document',
  fields: [
    defineField({
      name: 'sectionTitle',
      title: 'Заголовок секции',
      type: 'string',
      initialValue: 'Часто задаваемые вопросы',
    }),
  ],
  preview: {
    select: { title: 'sectionTitle' },
  },
})
