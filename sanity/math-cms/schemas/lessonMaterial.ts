import { defineField, defineType } from 'sanity'

export default defineType({
  name: 'lessonMaterial',
  title: 'Материал урока',
  type: 'object',
  fields: [
    defineField({ name: 'title', title: 'Название', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({
      name: 'materialType',
      title: 'Тип',
      type: 'string',
      options: {
        list: [
          { title: 'Файл', value: 'file' },
          { title: 'Ссылка', value: 'link' },
          { title: 'Текст', value: 'text' },
        ],
      },
      initialValue: 'file',
    }),
    defineField({ name: 'url', title: 'URL', type: 'url' }),
    defineField({ name: 'fileName', title: 'Имя файла', type: 'string' }),
    defineField({ name: 'fileSize', title: 'Размер', type: 'string' }),
  ],
})
