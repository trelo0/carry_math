import { defineField, defineType } from 'sanity'

export default defineType({
  name: 'lessonFile',
  title: 'Файл',
  type: 'object',
  fields: [
    defineField({
      name: 'file',
      title: 'Файл',
      type: 'file',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'published',
      title: 'Опубликован',
      type: 'boolean',
      initialValue: false,
      description: 'Файл виден ученикам в кабинете только когда включено',
    }),
  ],
  preview: {
    select: { fileName: 'file.asset.originalFilename', published: 'published' },
    prepare({ fileName, published }) {
      return {
        title: fileName ?? 'Файл',
        subtitle: published ? 'Опубликован' : 'Не опубликован',
      }
    },
  },
})
