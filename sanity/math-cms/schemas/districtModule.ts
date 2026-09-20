import { defineField, defineType, defineArrayMember } from 'sanity'

const MODULE_COLORS = [
  { title: 'Голубой', value: '#38c6ff' },
  { title: 'Синий', value: '#4f7cff' },
  { title: 'Фиолетовый', value: '#8b5cf6' },
  { title: 'Оранжевый', value: '#f59e0b' },
  { title: 'Зелёный', value: '#22c55e' },
  { title: 'Бирюзовый', value: '#14b8a6' },
  { title: 'Розовый', value: '#ec4899' },
  { title: 'Красный', value: '#ef4444' },
]

export default defineType({
  name: 'districtModule',
  title: 'Настройки модуля',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Название модуля',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'color',
      title: 'Цвет',
      type: 'string',
      options: { list: MODULE_COLORS },
      initialValue: '#38c6ff',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'sortOrder',
      title: 'Порядок в курсе',
      type: 'number',
      initialValue: 0,
      validation: (Rule) => Rule.required().min(0),
    }),
    defineField({
      name: 'lessons',
      title: 'Привязанные занятия',
      description: 'Список формируется автоматически при добавлении занятий в модуль',
      type: 'array',
      readOnly: true,
      of: [defineArrayMember({ type: 'reference', to: [{ type: 'districtCourseLesson' }] })],
    }),
    defineField({
      name: 'course',
      title: 'Курс',
      type: 'reference',
      to: [{ type: 'districtCourse' }],
      hidden: true,
      readOnly: true,
    }),
    defineField({
      name: 'description',
      title: 'Описание',
      type: 'text',
      hidden: true,
    }),
    defineField({
      name: 'period',
      title: 'Период',
      type: 'string',
      hidden: true,
    }),
  ],
  preview: {
    select: { title: 'title', sortOrder: 'sortOrder', lessons: 'lessons' },
    prepare({ title, sortOrder, lessons }) {
      const count = Array.isArray(lessons) ? lessons.length : 0
      return {
        title: title ?? 'Модуль',
        subtitle: [`M${(sortOrder ?? 0) + 1}`, count ? `${count} зан.` : 'без занятий'].join(' · '),
      }
    },
  },
})
