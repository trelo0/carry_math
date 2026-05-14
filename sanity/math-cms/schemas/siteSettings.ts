import { defineType, defineField, defineArrayMember } from 'sanity'

export default defineType({
  name: 'siteSettings',
  title: 'Настройки сайта',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Название (логотип)',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'footerDescription',
      title: 'Описание в футере',
      type: 'text',
    }),
    defineField({
      name: 'instagramUrl',
      title: 'Instagram URL',
      type: 'url',
    }),
    defineField({
      name: 'privacyPolicyUrl',
      title: 'Ссылка на политику конфиденциальности',
      type: 'url',
    }),
    defineField({
      name: 'headerButtonText',
      title: 'Текст кнопки в шапке',
      type: 'string',
      initialValue: 'Записаться',
    }),
    defineField({
      name: 'heroButtonText',
      title: 'Текст кнопки в hero',
      type: 'string',
      initialValue: 'Записаться на занятие',
    }),
    defineField({
      name: 'teacherCardButtonText',
      title: 'Текст кнопки в карточке преподавателя',
      type: 'string',
      initialValue: 'Записаться на пробное занятие',
    }),
  ],
})
