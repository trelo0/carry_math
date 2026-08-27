import { defineField, defineType, defineArrayMember } from 'sanity'

export default defineType({
  name: 'formatsBlock',
  title: 'Индивидуальные — Формат «Соло или команда»',
  type: 'document',
  fields: [
    defineField({
      name: 'kicker',
      title: 'Надзаголовок (киккер)',
      type: 'string',
      initialValue: 'КВЕСТ 03 // ВАРИАНТЫ ЗАНЯТИЙ :: VS MODE',
    }),
    defineField({
      name: 'sectionTitle',
      title: 'Заголовок секции',
      type: 'string',
      initialValue: 'Соло или команда?',
    }),
    defineField({
      name: 'columns',
      title: 'Колонки сравнения',
      description: 'Обычно две: «Одиночный рейд» и «Командный сектор».',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({
              name: 'icon',
              title: 'Иконка перед заголовком (эмодзи)',
              type: 'string',
            }),
            defineField({ name: 'title', title: 'Заголовок колонки', type: 'string' }),
            defineField({ name: 'sub', title: 'Подзаголовок (формат и классы)', type: 'string' }),
            defineField({ name: 'description', title: 'Описание', type: 'text', rows: 3 }),
            defineField({
              name: 'perks',
              title: 'Преимущества',
              type: 'array',
              of: [defineArrayMember({ type: 'string' })],
            }),
            defineField({ name: 'ctaText', title: 'Текст кнопки', type: 'string' }),
          ],
          preview: { select: { title: 'title' } },
        }),
      ],
      initialValue: [
        {
          _key: 'formatSolo',
          icon: '🗡',
          title: 'Одиночный рейд',
          sub: 'индивидуальные · 5–11 класс',
          description:
            'Личный маршрут по математике: программа, темп и фокус — только под тебя. Наставник ведёт от диагностики до экзамена.',
          perks: [
            'Программа строится под твою цель и стартовый уровень',
            'Гибкий график — занятия когда удобно, даже вечером',
            'Максимальное внимание наставника всё занятие',
            'Личный куратор и разбор каждой ошибки 24/7',
          ],
          ctaText: 'Записаться на соло',
        },
        {
          _key: 'formatGroup',
          icon: '🛡',
          title: 'Командный сектор',
          sub: 'мини-группы до 5 · 5–10 класс',
          description:
            'Мини-отряд единомышленников: общий рейтинг, командные квесты и дух соревнования. Качество то же, цена ниже.',
          perks: [
            'Цена ниже, качество подготовки то же',
            'Командный рейтинг и совместные квесты',
            'Игровая мотивация: уровни, лиги, награды',
            'Занятия в мини-группе до 5 человек',
          ],
          ctaText: 'Записаться в группу',
        },
      ],
    }),
  ],
  preview: { select: { title: 'sectionTitle' } },
})
