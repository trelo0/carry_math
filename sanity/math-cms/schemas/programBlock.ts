import { defineField, defineType, defineArrayMember } from 'sanity'

export default defineType({
  name: 'programBlock',
  title: 'Курс — Программа обучения',
  type: 'document',
  fields: [
    defineField({
      name: 'sectionTitle',
      title: 'Заголовок секции',
      type: 'string',
      initialValue: 'Программа обучения',
    }),
    defineField({
      name: 'missions',
      title: 'Миссии',
      description:
        'Карточки на карте миссий. Номера («Миссия 01») и XP добавляются автоматически по порядку.',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({ name: 'title', title: 'Название миссии', type: 'string' }),
            defineField({ name: 'text', title: 'Описание', type: 'text', rows: 2 }),
          ],
          preview: { select: { title: 'title' } },
        }),
      ],
      initialValue: [
        { _key: 'mission1', title: 'Диагностика', text: 'Определяем уровень, цели и точки роста.' },
        { _key: 'mission2', title: 'Личный план', text: 'Собираем программу под твои задачи.' },
        { _key: 'mission3', title: 'Практика', text: 'Решаем реальные варианты ЕГЭ и олимпиад.' },
        { _key: 'mission4', title: 'Контроль', text: 'Срезы, разбор ошибок и отчёты родителям.' },
        { _key: 'mission5', title: 'Победа', text: 'Выходим на экзамен подготовленным на 100%.' },
      ],
    }),
  ],
  preview: {
    select: { title: 'sectionTitle' },
  },
})
