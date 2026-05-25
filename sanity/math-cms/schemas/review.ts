import { defineField, defineType } from 'sanity';

export default defineType({
  name: 'review',
  title: 'Отзыв',
  type: 'document',
  fields: [
    defineField({
      name: 'image',
      title: 'Скриншот отзыва',
      type: 'image',
      options: { hotspot: true },
    }),
    defineField({
      name: 'caption',
      title: 'Имя ученика / подпись',
      type: 'string',
    }),
    defineField({
      name: 'teacherName',
      title: 'Имя преподавателя',
      type: 'string',
      description: 'Имя преподавателя, к которому относится отзыв',
    }),
  ],
  preview: {
    select: {
      media: 'image',
      title: 'caption',
      teacher: 'teacherName',
    },
    prepare({ media, title, teacher }) {
      return {
        media,
        title: title || 'Отзыв',
        subtitle: teacher || 'Без преподавателя',
      };
    },
  },
});
