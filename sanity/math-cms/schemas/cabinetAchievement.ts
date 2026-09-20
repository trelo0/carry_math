import { defineField, defineType } from 'sanity'

export default defineType({
  name: 'cabinetAchievement',
  title: 'Достижение кабинета',
  type: 'object',
  fields: [
    defineField({
      name: 'title',
      title: 'Название',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'subtitle',
      title: 'Описание',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'ruleKey',
      title: 'Правило разблокировки',
      type: 'string',
      options: {
        list: [
          { title: 'Пройдено 1 занятие', value: 'lesson_1' },
          { title: 'Пройдено 3 вебинара', value: 'webinar_3' },
          { title: '100+ баллов РТ', value: 'score_100' },
          { title: 'Первое принятое ДЗ', value: 'hw_approved_1' },
        ],
      },
      validation: (Rule) => Rule.required(),
    }),
  ],
  preview: {
    select: { title: 'title', subtitle: 'subtitle' },
  },
})
