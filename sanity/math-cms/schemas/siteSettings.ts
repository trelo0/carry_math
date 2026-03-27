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
  ],
})
