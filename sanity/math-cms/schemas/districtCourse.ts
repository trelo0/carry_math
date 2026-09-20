import { defineField, defineType, defineArrayMember } from 'sanity'

export default defineType({
  name: 'districtCourse',
  title: 'Настройки курса',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Название курса',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'cabinetEyebrow',
      title: 'Заголовок курса',
      description: 'Короткий заголовок над названием в кабинете',
      type: 'string',
      initialValue: 'Курс подготовки',
    }),
    defineField({
      name: 'description',
      title: 'Описание курса',
      type: 'text',
      rows: 4,
    }),
    defineField({
      name: 'coverImage',
      title: 'Обложка курса',
      type: 'image',
      options: { hotspot: true },
    }),
    defineField({
      name: 'curator',
      title: 'Преподаватель',
      type: 'reference',
      to: [{ type: 'teacher' }],
    }),
    defineField({
      name: 'deliveryFormat',
      title: 'Формат обучения',
      type: 'string',
      initialValue: 'Онлайн',
    }),
    defineField({
      name: 'cabinetPreviewInside',
      title: 'Что внутри',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
    }),
    defineField({
      name: 'cabinetPreviewAfterEnrollment',
      title: 'Что будет на курсе',
      type: 'text',
      rows: 3,
    }),
    defineField({
      name: 'cabinetPreviewAudience',
      title: 'Кому подойдёт',
      type: 'text',
      rows: 3,
    }),
    defineField({
      name: 'modules',
      title: 'Модули программы',
      description: 'Добавляются в разделе «Модули» в меню курса. На превью программа строится из них.',
      type: 'array',
      of: [defineArrayMember({ type: 'reference', to: [{ type: 'districtModule' }] })],
    }),
    defineField({
      name: 'homeworkIntro',
      title: 'Текст блока домашних заданий',
      type: 'text',
      rows: 3,
      hidden: true,
    }),
    defineField({
      name: 'cabinetPreviewImage',
      title: 'Картинка превью',
      type: 'image',
      hidden: true,
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'title', maxLength: 96 },
      hidden: true,
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'publicationStatus',
      title: 'Статус публикации',
      type: 'string',
      hidden: true,
      initialValue: 'published',
    }),
  ],
  preview: {
    select: { title: 'title', headline: 'cabinetEyebrow' },
    prepare({ title, headline }) {
      return { title: title ?? 'Курс', subtitle: headline ?? undefined }
    },
  },
})
