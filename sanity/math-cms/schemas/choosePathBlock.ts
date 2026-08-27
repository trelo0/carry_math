import { defineField, defineType, defineArrayMember } from 'sanity'

export default defineType({
  name: 'choosePathBlock',
  title: 'Индивидуальные — «Время выбрать свой путь» (запись)',
  description:
    'Заголовки и тексты блока записи. Сами наставники, услуги и цены — в документах «Наставник».',
  type: 'document',
  fields: [
    defineField({
      name: 'kicker',
      title: 'Надзаголовок (киккер)',
      type: 'string',
      initialValue: 'КВЕСТ 05 // ЗАПИСЬ :: START QUEST',
    }),
    defineField({
      name: 'sectionTitle',
      title: 'Заголовок секции (до золотой части)',
      type: 'string',
      initialValue: 'Время выбрать',
    }),
    defineField({
      name: 'sectionTitleGold',
      title: 'Заголовок секции (золотая часть)',
      type: 'string',
      initialValue: 'свой путь',
    }),
    defineField({
      name: 'soloTabText',
      title: 'Текст вкладки «соло»',
      type: 'string',
      initialValue: '🗡 Одиночный рейд',
    }),
    defineField({
      name: 'groupTabText',
      title: 'Текст вкладки «команда»',
      type: 'string',
      initialValue: '🛡 Командный сектор',
    }),
    defineField({
      name: 'trialGuideTitle',
      title: 'Блок о пробном занятии — заголовок',
      type: 'string',
      initialValue: 'Пробное занятие — первый шаг',
    }),
    defineField({
      name: 'trialGuideText',
      title: 'Блок о пробном занятии — текст',
      description: 'Перенос строки в тексте = разделение на два предложения.',
      type: 'text',
      initialValue:
        'Пробное занятие необходимо для начала индивидуальных занятий.\nОно поможет определить уровень и подобрать подходящую программу.',
    }),
    defineField({
      name: 'benefits',
      title: 'Преимущества внизу блока',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({ name: 'title', title: 'Заголовок', type: 'string' }),
            defineField({ name: 'text', title: 'Текст', type: 'string' }),
          ],
          preview: { select: { title: 'title' } },
        }),
      ],
      initialValue: [
        { _key: 'benefitPro', title: 'Профессиональные', text: 'опытные преподаватели' },
        { _key: 'benefitPersonal', title: 'Индивидуальный подход', text: 'программа под ваши цели' },
        { _key: 'benefitSchedule', title: 'Удобный график', text: 'занимайтесь в комфортное время' },
      ],
    }),
  ],
  preview: { select: { title: 'sectionTitle' } },
})
