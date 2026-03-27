import { defineField, defineType } from 'sanity'

export default defineType({
  name: 'homePage',
  title: 'Главная страница',
  type: 'document',
  fields: [
    defineField({
      name: 'heroTitle',
      title: 'Заголовок Главного экрана',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'heroDescription',
      title: 'Описание Главного экрана',
      type: 'text',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'sectionProblemsTitle',
      title: 'Заголовок секции проблем',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'sectionProblemsSubtitle',
      title: 'Подзаголовок секции проблем',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'sectionMethodTitle',
      title: 'Заголовок секции системы достижения',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'sectionMethodSubtitle',
      title: 'Подзаголовок секции системы достижения',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'sectionCoursesTitle',
      title: 'Заголовок секции курсов',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'sectionCoursesSubtitle',
      title: 'Подзаголовок секции курсов',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'sectionTeachersTitle',
      title: 'Заголовок секции преподавателей',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'sectionTeachersSubtitle',
      title: 'Подзаголовок секции преподавателей',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'sectionProcessTitle',
      title: 'Заголовок секции как проходят занятия',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'sectionProcessSubtitle',
      title: 'Подзаголовок секции как проходят занятия',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
  ],
})