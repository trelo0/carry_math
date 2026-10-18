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
      description:
        '1 = первое занятие в модуле, 2 = второе и т.д. При создании через «Занятия» номер ставится автоматически; можно изменить вручную.',
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
      validation: (Rule) =>
        Rule.custom((value) => {
          if (value == null || (typeof value === 'string' && !value.trim())) return true
          if (typeof value === 'string' && URL.canParse(value)) return true
          return 'Укажите полную ссылку (https://…)'
        }),
    }),
    defineField({
      name: 'recordingUrl',
      title: 'Ссылка на запись',
      type: 'url',
      validation: (Rule) =>
        Rule.custom((value) => {
          if (value == null || (typeof value === 'string' && !value.trim())) return true
          if (typeof value === 'string' && URL.canParse(value)) return true
          return 'Укажите полную ссылку (https://…)'
        }),
    }),
    defineField({
      name: 'lessonMaterials',
      title: 'Материалы к занятию',
      description:
        'Необязательно при создании. Обычно файлы добавляет куратор в личном кабинете во время вебинара. Здесь — только если нужно заранее.',
      type: 'array',
      of: [defineArrayMember({ type: 'lessonFile' })],
    }),
    defineField({
      name: 'lessonHomeworkFiles',
      title: 'Домашнее задание',
      description:
        'Необязательно при создании. Файлы ДЗ чаще выкладывает куратор в кабинете после эфира. В кабинете видны только с включённой публикацией.',
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
      weak: true,
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
      title: 'Пробное / бесплатное',
      description:
        'Включено — занятие открывается при записи на курс бесплатно и не списывает кредит из оплаченного пакета. Можно включать/выключать в любой момент.',
      type: 'boolean',
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
      options: { collapsible: false },
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
