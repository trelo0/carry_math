import { defineArrayMember, defineField, defineType } from 'sanity'

export default defineType({
  name: 'cabinetSettings',
  title: 'Цены кабинета',
  type: 'document',
  fields: [
    defineField({
      name: 'teachers',
      title: 'Преподаватели',
      description: 'Используются в табах при покупке индивидуальных и групповых занятий',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'cabinetTeacher',
          fields: [
            defineField({
              name: 'teacherId',
              title: 'ID (латиница, без пробелов)',
              description: 'Например: kristina, anna',
              type: 'string',
              validation: (Rule) => Rule.required().regex(/^[a-z0-9_-]+$/),
            }),
            defineField({
              name: 'name',
              title: 'Имя на сайте',
              type: 'string',
              validation: (Rule) => Rule.required(),
            }),
            defineField({
              name: 'telegramId',
              title: 'Telegram ID',
              description:
                'Числовой telegram_id из админ-бота (Пользователи). Для auto-назначения после покупки ind/group. Можно менять без деплоя.',
              type: 'number',
            }),
          ],
          preview: {
            select: { title: 'name', subtitle: 'teacherId' },
          },
        }),
      ],
    }),
    defineField({
      name: 'courseOffer',
      title: 'Курс District',
      type: 'object',
      fields: [
        defineField({
          name: 'description',
          title: 'Описание на карточке',
          type: 'text',
          rows: 3,
        }),
        defineField({
          name: 'priceByn',
          title: 'Цена курса (BYN)',
          type: 'number',
          validation: (Rule) => Rule.required().min(0),
        }),
      ],
    }),
    defineField({
      name: 'individualPackages',
      title: 'Индивидуальные пакеты',
      type: 'array',
      of: [defineArrayMember({ type: 'cabinetLessonPackage' })],
    }),
    defineField({
      name: 'groupPackages',
      title: 'Групповые пакеты',
      type: 'array',
      of: [defineArrayMember({ type: 'cabinetLessonPackage' })],
    }),
    defineField({
      name: 'individualOffer',
      title: 'Индивидуальные занятия (checkout)',
      type: 'object',
      fields: [
        defineField({
          name: 'description',
          title: 'Описание на странице оплаты',
          type: 'text',
          rows: 3,
        }),
      ],
    }),
    defineField({
      name: 'groupOffer',
      title: 'Групповые занятия (checkout)',
      type: 'object',
      fields: [
        defineField({
          name: 'description',
          title: 'Описание на странице оплаты',
          type: 'text',
          rows: 3,
        }),
      ],
    }),
    defineField({
      name: 'defaultCuratorTelegramId',
      title: 'Куратор курса (Telegram ID)',
      description:
        'Auto-назначение куратора при покупке курса. ID из админ-бота, роль curator. Пусто — назначаете вручную.',
      type: 'number',
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
    defineField({
      name: 'achievements',
      title: 'Достижения',
      type: 'array',
      of: [defineArrayMember({ type: 'cabinetAchievement' })],
    }),
  ],
  preview: {
    prepare() {
      return { title: 'Цены кабинета' }
    },
  },
})
