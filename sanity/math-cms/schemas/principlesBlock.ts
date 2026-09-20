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
      title: 'Заголовок секции (первая строка)',
      type: 'string',
      initialValue: 'Три принципа, на',
    }),
    defineField({
      name: 'sectionTitleGold',
      title: 'Заголовок секции (вторая строка, оранжевая)',
      type: 'string',
      initialValue: 'которых мы стоим',
    }),
    defineField({
      name: 'sectionSubtitle',
      title: 'Подзаголовок секции (каждое предложение с новой строки)',
      type: 'text',
      rows: 3,
    }),
  ],
  preview: { select: { title: 'sectionTitle' } },
})
