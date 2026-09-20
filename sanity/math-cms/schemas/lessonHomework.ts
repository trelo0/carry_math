import { defineField, defineType } from 'sanity'

export default defineType({
  name: 'lessonHomework',
  title: 'Домашнее задание',
  type: 'object',
  fields: [
    defineField({ name: 'title', title: 'Название', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'description', title: 'Описание', type: 'text', rows: 3 }),
    defineField({ name: 'fileName', title: 'Имя файла', type: 'string' }),
    defineField({ name: 'fileSize', title: 'Размер', type: 'string' }),
    defineField({ name: 'url', title: 'Ссылка на файл', type: 'url' }),
    defineField({
      name: 'mandatory',
      title: 'Обязательное ДЗ',
      type: 'boolean',
      initialValue: true,
    }),
  ],
})
