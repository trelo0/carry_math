import { defineField, defineType } from 'sanity'

export default defineType({
  name: 'principlesBlock',
  title: 'Индивидуальные — Принципы (заголовки)',
  description:
    'Заголовки секции принципов. Сами принципы и статистика — отдельные документы «Принцип» и «Статистика».',
  type: 'document',
  fields: [
    defineField({
      name: 'kicker',
      title: 'Надзаголовок (киккер)',
      type: 'string',
      initialValue: 'КВЕСТ 02 // СТАТИСТИКА + ПРИНЦИПЫ :: CODE',
    }),
    defineField({
      name: 'sectionTitle',
      title: 'Заголовок секции',
      type: 'string',
      initialValue: 'Принципы гильдии',
    }),
    defineField({
      name: 'sectionSubtitle',
      title: 'Подзаголовок секции',
      type: 'string',
    }),
  ],
  preview: { select: { title: 'sectionTitle' } },
})
