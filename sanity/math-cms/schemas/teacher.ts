import { defineType, defineField, defineArrayMember } from 'sanity'

export default defineType({
  name: 'teacher',
  title: 'Наставник',
  type: 'document',
  fields: [
    defineField({ name: 'name', title: 'Имя', type: 'string' }),
    defineField({ name: 'subject', title: 'Предмет', type: 'string' }),
    defineField({ name: 'description', title: 'Описание', type: 'text' }),
    defineField({
      name: 'badges',
      title: 'Чипы-достижения',
      description: 'Короткие чипы под описанием карточки наставника на странице /individual: «98 баллов ЦТ», «БГУ, мехмат» и т.п. Если оставить пустым — покажутся общие чипы блока «Наставники».',
      type: 'array',
      of: [{ type: 'string' }],
    }),
    defineField({ name: 'photo', title: 'Фото', type: 'image' }),
    defineField({ name: 'hasSpots', title: 'Есть места', type: 'boolean' }),
    defineField({
      name: 'trialLesson',
      title: 'Пробное занятие',
      type: 'object',
      fields: [
        defineField({ name: 'price', title: 'Цена', type: 'string' }),
        defineField({ name: 'duration', title: 'Длительность', type: 'string', placeholder: 'например: 60 мин' }),
        defineField({ name: 'description', title: 'Описание', type: 'text' }),
      ],
    }),

    defineField({
      name: 'reviews',
      title: 'Отзывы',
      description: 'Скриншоты отзывов учеников. Показываются под карточкой преподавателя на сайте.',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'teacherReview',
          title: 'Отзыв',
          fields: [
            defineField({
              name: 'image',
              title: 'Скриншот отзыва',
              type: 'image',
              options: { hotspot: true },
              validation: (Rule) => Rule.required(),
            }),
            defineField({
              name: 'caption',
              title: 'Имя ученика / подпись',
              type: 'string',
            }),
          ],
          preview: {
            select: { media: 'image', title: 'caption' },
            prepare({ media, title }) {
              return { media, title: title || 'Отзыв без подписи' }
            },
          },
        }),
      ],
    }),

    defineField({
      name: 'services',
      title: 'Услуги',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({ name: 'name', title: 'Название', type: 'string' }),
            defineField({ name: 'price', title: 'Цена', type: 'string' }),
            defineField({ name: 'duration', title: 'Длительность', type: 'string', placeholder: 'например: 60 мин' }),
            defineField({
              name: 'spotsStatus',
              title: 'Статус мест',
              type: 'object',
              fields: [
                defineField({
                  name: 'type',
                  title: 'Количество мест',
                  type: 'string',
                  options: {
                    list: [
                      { title: 'Много мест', value: 'many' },
                      { title: 'Мало мест', value: 'few' },
                      { title: 'Мест нет', value: 'none' },
                      { title: 'Кастомный текст', value: 'custom' },
                    ],
                  },
                }),
                defineField({
                  name: 'count',
                  title: 'Сколько мест осталось',
                  type: 'number',
                  hidden: ({ parent }) => parent?.type !== 'few',
                }),
                defineField({
                  name: 'text',
                  title: 'Текст',
                  type: 'string',
                  hidden: ({ parent }) => parent?.type !== 'custom',
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  ],
})