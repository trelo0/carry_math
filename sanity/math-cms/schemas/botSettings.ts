import { defineArrayMember, defineField, defineType } from 'sanity'

export default defineType({
  name: 'botSettings',
  title: 'Тексты Telegram-бота',
  type: 'document',
  fields: [
    defineField({
      name: 'messages',
      title: 'Сообщения',
      description:
        'Ключ (key) задаётся в коде. Если body пустой — используется текст по умолчанию из приложения.',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'botMessage',
          fields: [
            defineField({
              name: 'key',
              title: 'Ключ',
              type: 'string',
              validation: (Rule) => Rule.required(),
            }),
            defineField({
              name: 'title',
              title: 'Название для админа',
              description: 'Где показывается сообщение (шаг заявки, экран гостя и т.д.)',
              type: 'string',
              validation: (Rule) => Rule.required(),
            }),
            defineField({
              name: 'body',
              title: 'Текст сообщения',
              type: 'text',
              rows: 6,
            }),
          ],
          preview: {
            select: { title: 'title', subtitle: 'key' },
          },
        }),
      ],
    }),
  ],
})
