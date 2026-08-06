import { defineType, defineField, defineArrayMember } from 'sanity'

export default defineType({
  name: 'siteSettings',
  title: 'Настройки сайта',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Название (логотип)',
      description: 'Например: District',
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
    defineField({
      name: 'modalTitle',
      title: 'Заголовок модального окна записи',
      type: 'string',
      initialValue: 'Запись на занятие',
    }),
    defineField({
      name: 'modalSubmitButtonText',
      title: 'Текст кнопки отправки в модальном окне',
      type: 'string',
      initialValue: 'Отправить заявку',
    }),
  ],
})
