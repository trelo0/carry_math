import { defineField, defineType, defineArrayMember } from 'sanity'

export default defineType({
  name: 'individualHeroBlock',
  title: 'Индивидуальные — Hero-блок',
  type: 'document',
  fields: [
    defineField({
      name: 'kicker',
      title: 'Надзаголовок (киккер)',
      description: 'Техническая строка над заголовком, например: «ФОРМАТЫ ЗАНЯТИЙ // 5–11 КЛАСС».',
      type: 'string',
      initialValue: 'ФОРМАТЫ ЗАНЯТИЙ // 5–11 КЛАСС',
    }),
    defineField({
      name: 'title',
      title: 'Главный заголовок',
      description: 'Последнее слово автоматически подсвечивается золотым.',
      type: 'string',
      initialValue: 'Занятия с наставником гильдии',
    }),
    defineField({
      name: 'description',
      title: 'Описание',
      type: 'text',
      initialValue:
        'Индивидуальные уроки один на один с наставником и мини-группы до 5 человек — выбери свой формат и идём к цели вместе.',
    }),
    defineField({
      name: 'panelTitle',
      title: 'Заголовок панели «Выбор пути»',
      type: 'string',
      initialValue: 'Выбор пути',
    }),
    defineField({
      name: 'slots',
      title: 'Пункты панели выбора',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({ name: 'icon', title: 'Иконка (эмодзи)', type: 'string' }),
            defineField({ name: 'title', title: 'Название', type: 'string' }),
            defineField({ name: 'sub', title: 'Подпись', type: 'string' }),
            defineField({
              name: 'href',
              title: 'Якорь ссылки',
              description: 'Куда ведёт пункт, например: #formats-solo',
              type: 'string',
            }),
          ],
          preview: { select: { title: 'title' } },
        }),
      ],
      initialValue: [
        { _key: 'slotSolo', icon: '🗡', title: 'Одиночный рейд', sub: 'индивидуальные · 5–11 класс', href: '#formats-solo' },
        { _key: 'slotGroup', icon: '🛡', title: 'Командный сектор', sub: 'мини-группы до 5 · 5–10 класс', href: '#formats-group' },
      ],
    }),
  ],
  preview: { select: { title: 'title' } },
})
