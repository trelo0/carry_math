import { defineArrayMember, defineField, defineType } from 'sanity'

export default defineType({
  name: 'cabinetAsideSettings',
  title: 'Боковая панель кабинета',
  type: 'document',
  fields: [
    defineField({
      name: 'cabinetQuotes',
      title: 'Цитаты',
      description: 'Показываются в боковой панели. Каждый день — следующая по кругу.',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'cabinetQuote',
          fields: [
            defineField({
              name: 'text',
              title: 'Текст',
              type: 'text',
              rows: 3,
              validation: (Rule) => Rule.required(),
            }),
            defineField({
              name: 'author',
              title: 'Подпись',
              type: 'string',
              initialValue: 'District',
            }),
          ],
          preview: {
            select: { title: 'text', subtitle: 'author' },
          },
        }),
      ],
    }),
    defineField({
      name: 'achievements',
      title: 'Достижения',
      type: 'array',
      of: [defineArrayMember({ type: 'cabinetAchievement' })],
    }),
    defineField({
      name: 'examDate',
      title: 'Дата ЦТ / экзамена',
      type: 'date',
      description: 'Для счётчика в боковой панели кабинета',
    }),
    defineField({
      name: 'examLabel',
      title: 'Подпись счётчика',
      type: 'string',
      initialValue: 'До ЦТ по математике',
    }),
  ],
  preview: {
    prepare() {
      return { title: 'Боковая панель' }
    },
  },
})
