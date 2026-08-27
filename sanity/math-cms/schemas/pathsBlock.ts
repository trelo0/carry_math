import { defineField, defineType, defineArrayMember } from 'sanity'

export default defineType({
  name: 'pathsBlock',
  title: 'Курс — «Не подошёл курс?» (развилка)',
  type: 'document',
  fields: [
    defineField({
      name: 'sectionTitle',
      title: 'Заголовок секции',
      type: 'string',
      initialValue: 'Не подошёл курс?',
    }),
    defineField({
      name: 'columns',
      title: 'Колонки',
      description: 'Обычно две: «Одиночный рейд» и «Командный сектор».',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({ name: 'title', title: 'Заголовок колонки', type: 'string' }),
            defineField({
              name: 'sub',
              title: 'Подзаголовок (формат и классы)',
              type: 'string',
            }),
            defineField({ name: 'description', title: 'Описание', type: 'text', rows: 3 }),
            defineField({
              name: 'perks',
              title: 'Преимущества',
              type: 'array',
              of: [defineArrayMember({ type: 'string' })],
            }),
          ],
          preview: { select: { title: 'title' } },
        }),
      ],
      initialValue: [
        {
          _key: 'pathRaid',
          title: 'Одиночный рейд',
          sub: 'Индивидуальные занятия с наставником 5–11 класс',
          description:
            'Личный маршрут по математике: программа, темп и фокус — только под тебя. Наставник ведёт от диагностики до экзамена.',
          perks: [
            'Программа строится под твою цель и стартовый уровень',
            'Гибкий график — занятия когда удобно, даже вечером',
            'Максимальное внимание наставника всё занятие',
            'Личный куратор и разбор каждой ошибки 24/7',
          ],
        },
        {
          _key: 'pathSquad',
          title: 'Командный сектор',
          sub: 'Занятия в мини-группах до 5-ти человек 5–10 класс',
          description:
            'Мини-отряд до 5 человек: общий рейтинг, командные квесты и дух соревнования — мотивация, которой не хватает в одиночку.',
          perks: [
            'Цена ниже, качество подготовки то же',
            'Командный рейтинг и совместные квесты',
            'Игровая мотивация: уровни, лиги, награды',
            'Занятия в мини-группе до 5 человек',
          ],
        },
      ],
    }),
    defineField({
      name: 'ctaText',
      title: 'Текст кнопки внизу',
      type: 'string',
      initialValue: 'Узнать больше',
    }),
  ],
  preview: {
    select: { title: 'sectionTitle' },
  },
})
