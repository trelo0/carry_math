import { defineField, defineType, defineArrayMember } from 'sanity'

export default defineType({
  name: 'diagnosticBlock',
  title: 'Индивидуальные — «В чём сильная сторона» (диагностика)',
  type: 'document',
  fields: [
    defineField({
      name: 'eyebrow',
      title: 'Левая секция — надзаголовок',
      type: 'string',
      initialValue: 'Диагностика способностей',
    }),
    defineField({
      name: 'title',
      title: 'Левая секция — заголовок',
      type: 'string',
      initialValue: 'В чём твоя сильная сторона?',
    }),
    defineField({
      name: 'text',
      title: 'Левая секция — текст',
      type: 'text',
      initialValue:
        'Авторская диагностика подберёт направление под твой стиль мышления. Без подготовки и «правильных ответов» — только твои реальные способности.',
    }),
    defineField({
      name: 'buttonText',
      title: 'Левая секция — текст кнопки',
      type: 'string',
      initialValue: 'Пройти диагностику',
    }),
    defineField({
      name: 'steps',
      title: 'Правая секция — шаги',
      description: 'Номера (01, 02, 03…) добавляются автоматически по порядку.',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({ name: 'title', title: 'Заголовок', type: 'string' }),
            defineField({ name: 'text', title: 'Текст', type: 'text' }),
          ],
          preview: { select: { title: 'title' } },
        }),
      ],
      initialValue: [
        {
          _key: 'diagStep1',
          title: 'Диагностика',
          text: '15 минут интерактивной симуляции определяют твои сильные стороны.',
        },
        {
          _key: 'diagStep2',
          title: 'Выбор направления',
          text: 'Результат — персональная рекомендация. Финальное решение за тобой.',
        },
        {
          _key: 'diagStep3',
          title: 'Старт подготовки',
          text: 'Работа с наставником, с которым реальный прогресс в подготовке.',
        },
      ],
    }),
  ],
  preview: { select: { title: 'title' } },
})
