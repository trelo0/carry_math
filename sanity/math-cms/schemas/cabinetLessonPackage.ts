import { defineArrayMember, defineField, defineType } from 'sanity'
import { TeacherPricesInput } from '../../components/TeacherPricesInput'

export default defineType({
  name: 'cabinetLessonPackage',
  title: 'Пакет занятий',
  type: 'object',
  fields: [
    defineField({
      name: 'name',
      title: 'Название',
      description: 'Например: «1 занятие», «4 занятия»',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'savingsChip',
      title: 'Чип «Экономия»',
      description: 'Необязательно. Например: «Экономия 10 BYN». Если пусто — чип не показывается.',
      type: 'string',
    }),
    defineField({
      name: 'prices',
      title: 'Цены по преподавателям',
      description: 'Подставляются все преподаватели из блока «Преподаватели»',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'teacherPrice',
          fields: [
            defineField({ name: 'teacherId', type: 'string' }),
            defineField({ name: 'priceByn', type: 'number' }),
          ],
        },
      ],
      components: { input: TeacherPricesInput as never },
    }),
  ],
  preview: {
    select: { title: 'name' },
  },
})
