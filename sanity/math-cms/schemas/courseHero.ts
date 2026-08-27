import { defineField, defineType, defineArrayMember } from 'sanity'

export default defineType({
  name: 'courseHero',
  title: 'Курс — Hero (главный экран)',
  type: 'document',
  fields: [
    defineField({
      name: 'eyebrow',
      title: 'Надзаголовок',
      description: 'Например: «Онлайн-школа по математике»',
      type: 'string',
      initialValue: 'Онлайн-школа по математике',
    }),
    defineField({
      name: 'headline',
      title: 'Главный заголовок',
      description:
        'Например: «Готовим победителей». Последнее слово автоматически подсвечивается золотым.',
      type: 'string',
      initialValue: 'Готовим победителей',
    }),
    defineField({
      name: 'pills',
      title: 'Короткие преимущества',
      description: 'Пилюли в первой карточке: «Живые вебинары» и т.д.',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      initialValue: [
        'Живые вебинары',
        'Геймифицированная платформа',
        'Личный куратор',
      ],
    }),
    defineField({
      name: 'questTitle',
      title: 'Квест-блок — заголовок',
      type: 'string',
      initialValue: 'Здесь подготовка - это квест',
    }),
    defineField({
      name: 'questNote',
      title: 'Квест-блок — подводка',
      type: 'string',
      initialValue: 'Ты не просто учишь формулы, ты:',
    }),
    defineField({
      name: 'questPoints',
      title: 'Квест-блок — пункты',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      initialValue: [
        'Открываешь секретные коды фракций',
        'Прокачиваешь личный прогресс на карте',
        'Общаешься с наставником в закрытом ТГ-канале',
      ],
    }),
    defineField({
      name: 'buttonText',
      title: 'Текст кнопки записи',
      type: 'string',
      initialValue: 'Записаться',
    }),
  ],
  preview: {
    select: { title: 'headline' },
  },
})
