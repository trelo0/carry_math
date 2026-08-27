import { defineField, defineType, defineArrayMember } from 'sanity'

export default defineType({
  name: 'mentorBlock',
  title: 'Курс — Наставник',
  type: 'document',
  fields: [
    defineField({
      name: 'sectionTitle',
      title: 'Заголовок секции',
      type: 'string',
      initialValue: 'Твой наставник по математике',
    }),
    defineField({
      name: 'specs',
      title: 'Характеристики (шкалы)',
      description: 'Название характеристики и значение в процентах (0–100).',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({ name: 'label', title: 'Название', type: 'string' }),
            defineField({ name: 'value', title: 'Значение, %', type: 'number' }),
          ],
          preview: { select: { title: 'label', subtitle: 'value' } },
        }),
      ],
      initialValue: [
        { _key: 'spec1', label: 'Харизма и удержание внимания', value: 98 },
        { _key: 'spec2', label: 'Взлом ЦТ / декодирование информации', value: 100 },
        { _key: 'spec3', label: 'Ментальная стойкость', value: 95 },
        { _key: 'spec4', label: 'Прокачка новичков', value: 92 },
        { _key: 'spec5', label: 'Индекс занудства', value: 4 },
        { _key: 'spec6', label: 'Синхронизация (понятный язык)', value: 99 },
      ],
    }),
    defineField({
      name: 'journal',
      title: 'Журнал заданий',
      description: 'Разделы журнала: название и текстовое описание.',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({ name: 'title', title: 'Название раздела', type: 'string' }),
            defineField({ name: 'text', title: 'Описание', type: 'text', rows: 4 }),
          ],
          preview: { select: { title: 'title' } },
        }),
      ],
      initialValue: [
        {
          _key: 'journal1',
          title: 'Год инициации в системе (опыт)',
          text: 'Преподавательский стаж 4 года',
        },
        {
          _key: 'journal2',
          title: 'Базовый сектор подготовки (образование)',
          text: '2019 — лицей №2, физмат профиль\n2023 — БГУ, механико-математический факультет, специальность: математика [научно-педагогическая деятельность]',
        },
        {
          _key: 'journal3',
          title: 'Главный боевой трофей (результат)',
          text: 'Личный результат: 98 баллов ЦТ',
        },
      ],
    }),
    defineField({
      name: 'mentorName',
      title: 'Имя наставника',
      type: 'string',
      initialValue: 'Лидия Владимировна',
    }),
    defineField({
      name: 'mentorClass',
      title: 'Класс персонажа',
      description: 'Подпись над именем на карточке.',
      type: 'string',
      initialValue: 'Наставник гильдии',
    }),
    defineField({
      name: 'mentorLevel',
      title: 'Уровень персонажа',
      description: 'Подпись под именем на карточке.',
      type: 'string',
      initialValue: 'LVL 99 · МАТЕМАТИКА',
    }),
    defineField({
      name: 'badges',
      title: 'Достижения (бейджи)',
      description: 'Символ ❖ добавляется автоматически.',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      initialValue: ['98 баллов ЦТ', '4 года опыта', 'БГУ, мехмат'],
    }),
    defineField({
      name: 'quoteStatus',
      title: 'Цитата — статусная строка',
      type: 'string',
      initialValue: '[Наставник гильдии online. Сектор MM-01]',
    }),
    defineField({
      name: 'quoteText',
      title: 'Цитата наставника',
      description: 'Кавычки «…» добавляются автоматически.',
      type: 'text',
      rows: 4,
      initialValue:
        'Математика — это четкая архитектура. Я научу твой мозг видеть скрытые ловушки составителей тестов за три секунды. Экзамен — это просто финальный босс, которого мы обязаны пройти на максимум.',
    }),
  ],
  preview: {
    select: { title: 'mentorName' },
  },
})
