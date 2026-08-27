import { defineField, defineType, defineArrayMember } from 'sanity'

export default defineType({
  name: 'teachersBlock',
  title: 'Индивидуальные — Наставники (заголовки)',
  description:
    'Заголовки секции наставников. Сами карточки (имя, фото, услуги, цены) — отдельные документы «Наставник».',
  type: 'document',
  fields: [
    defineField({
      name: 'kicker',
      title: 'Надзаголовок (киккер)',
      type: 'string',
      initialValue: 'КВЕСТ 01 // ОТРЯД ГИЛЬДИИ :: SELECT',
    }),
    defineField({
      name: 'sectionTitle',
      title: 'Заголовок секции',
      type: 'string',
      initialValue: 'Выбери наставника',
    }),
    defineField({
      name: 'badges',
      title: 'Бейджи достижений в карточках',
      description: 'Символ ❖ добавляется автоматически.',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      initialValue: ['98 баллов ЦТ', '4 года опыта', 'БГУ, мехмат'],
    }),
  ],
  preview: { select: { title: 'sectionTitle' } },
})
