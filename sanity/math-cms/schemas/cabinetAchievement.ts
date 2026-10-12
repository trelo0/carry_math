import { defineField, defineType } from 'sanity'

const RULE_OPTIONS = [
  { title: 'Куплен пакет курса', value: 'course_package_purchased' },
  { title: 'Записан на курс', value: 'course_enrolled' },
  { title: 'Открыта карта курса', value: 'course_map_viewed' },
  { title: 'Пройден 1 урок', value: 'lesson_complete_1' },
  { title: 'Пройдено 5 уроков', value: 'lesson_complete_5' },
  { title: 'Пройдено 10 уроков', value: 'lesson_complete_10' },
  { title: 'Просмотрен 1 вебинар', value: 'webinar_complete_1' },
  { title: 'Просмотрено 3 вебинара', value: 'webinar_complete_3' },
  { title: 'Сдано первое ДЗ', value: 'hw_submitted_1' },
  { title: 'Первое ДЗ принято', value: 'hw_approved_1' },
  { title: 'Принято 5 ДЗ', value: 'hw_approved_5' },
  { title: 'Участие в эфире', value: 'webinar_live_1' },
  { title: 'Просмотр записи урока', value: 'recording_watched_1' },
  { title: 'Первое сообщение куратору', value: 'curator_message_1' },
  { title: 'Профиль заполнен', value: 'profile_complete' },
  { title: '100+ баллов РТ', value: 'score_100' },
  { title: 'Куплен пакет занятий', value: 'individual_package_purchased' },
  { title: 'Запись на занятие', value: 'group_lesson_scheduled' },
  { title: 'Первая оплата', value: 'payment_success_1' },
  { title: '(legacy) 1 урок', value: 'lesson_1' },
  { title: '(legacy) 3 вебинара', value: 'webinar_3' },
] as const

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
      options: { list: [...RULE_OPTIONS] },
      validation: (Rule) => Rule.required(),
    }),
  ],
  preview: {
    select: { title: 'title', subtitle: 'subtitle' },
  },
})
