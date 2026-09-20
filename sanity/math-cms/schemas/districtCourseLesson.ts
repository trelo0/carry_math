import { defineField, defineType, defineArrayMember } from 'sanity'

export default defineType({
  name: 'districtCourseLesson',
  title: 'Настройки занятия',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Название',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'lessonDate',
      title: 'Дата',
      type: 'date',
    }),
    defineField({
      name: 'description',
      title: 'Описание',
      type: 'text',
      rows: 4,
    }),
    defineField({
      name: 'moduleOrder',
      title: 'Порядок в модуле',
      type: 'number',
      validation: (Rule) => Rule.required().min(1),
    }),
    defineField({
      name: 'contentChips',
      title: 'Чипы',
      description: 'До 4 пунктов в карточке занятия',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      validation: (Rule) => Rule.max(4),
      initialValue: ['Теория', 'Разбор задач', 'Практика', 'Домашнее задание'],
    }),
    defineField({
      name: 'liveUrl',
      title: 'Ссылка на трансляцию',
      type: 'url',
    }),
    defineField({
      name: 'recordingUrl',
      title: 'Ссылка на запись',
      type: 'url',
    }),
    defineField({
      name: 'lessonMaterials',
      title: 'Материалы к занятию',
      description: 'В кабинете видны только с включённой публикацией.',
      type: 'array',
      of: [defineArrayMember({ type: 'lessonFile' })],
    }),
    defineField({
      name: 'lessonHomeworkFiles',
      title: 'Домашнее задание',
      description: 'Файлы ДЗ. В кабинете видны только с включённой публикацией.',
      type: 'array',
      of: [defineArrayMember({ type: 'lessonFile' })],
    }),
    defineField({
      name: 'lessonFiles',
      title: 'Файлы (legacy)',
      type: 'array',
      hidden: true,
      of: [defineArrayMember({ type: 'lessonFile' })],
    }),
    defineField({
      name: 'materialsFile',
      title: 'Файл материалов (legacy)',
      type: 'file',
      hidden: true,
    }),
    defineField({
      name: 'homeworkFile',
      title: 'Файл домашнего задания (legacy)',
      type: 'file',
      hidden: true,
    }),
    defineField({
      name: 'module',
      title: 'Модуль',
      type: 'reference',
      to: [{ type: 'districtModule' }],
      hidden: true,
      readOnly: true,
    }),
    defineField({
      name: 'publicationStatus',
      title: 'Статус',
      type: 'string',
      hidden: true,
      initialValue: 'published',
    }),
    defineField({
      name: 'lessonType',
      title: 'Тип',
      type: 'string',
      hidden: true,
      initialValue: 'webinar',
    }),
    defineField({
      name: 'mandatoryHomework',
      title: 'Обязательное ДЗ',
      type: 'boolean',
      hidden: true,
      initialValue: true,
    }),
    defineField({
      name: 'isTrialFree',
      title: 'Пробное',
      type: 'boolean',
      hidden: true,
      initialValue: false,
    }),
    defineField({
      name: 'lessonNumber',
      title: 'Номер в курсе',
      type: 'number',
      hidden: true,
      readOnly: true,
    }),
    defineField({
      name: 'sortOrder',
      title: 'Порядок',
      type: 'number',
      hidden: true,
    }),
    defineField({
      name: 'scheduledAt',
      title: 'Дата трансляции',
      type: 'datetime',
      hidden: true,
    }),
    defineField({
      name: 'materials',
      title: 'Материалы (legacy)',
      type: 'array',
      hidden: true,
      of: [defineArrayMember({ type: 'lessonMaterial' })],
    }),
    defineField({
      name: 'homework',
      title: 'Домашка (legacy)',
      type: 'lessonHomework',
      hidden: true,
    }),
    defineField({
      name: 'curriculumBlock',
      title: 'Блок программы',
      type: 'string',
      hidden: true,
    }),
  ],
  orderings: [
    { title: 'Порядок в модуле', name: 'moduleOrderAsc', by: [{ field: 'moduleOrder', direction: 'asc' }] },
  ],
  preview: {
    select: { title: 'title', moduleOrder: 'moduleOrder', lessonDate: 'lessonDate' },
    prepare({ title, moduleOrder, lessonDate }) {
      const num = moduleOrder != null ? `${moduleOrder}. ` : ''
      return {
        title: `${num}${title ?? 'Занятие'}`,
        subtitle: lessonDate ?? undefined,
      }
    },
  },
})
