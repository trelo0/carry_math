import { defineField, defineType, defineArrayMember } from 'sanity'

export default defineType({
  name: 'diagnosticBlock',
  title: 'Индивидуальные — «Система подготовки»',
  type: 'document',
  description: 'Текст блока «Система подготовки» внизу страницы /individual.',
  fields: [
    defineField({
      name: 'eyebrow',
      title: 'Левая секция — надзаголовок',
      type: 'string',
      initialValue: 'Система подготовки',
    }),
    defineField({
      name: 'title',
      title: 'Левая секция — заголовок',
      type: 'string',
      initialValue: 'Твой путь к результату',
    }),
    defineField({
      name: 'text',
      title: 'Левая секция — текст',
      type: 'text',
      initialValue:
        'Понятная система обучения, которая помогает двигаться от первых тем к уверенным знаниям. Шаг за шагом, в своём темпе.',
    }),
    defineField({
      name: 'buttonText',
      title: 'Кнопка (не используется на сайте)',
      type: 'string',
      readOnly: true,
      initialValue: '',
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
          title: 'Понятная программа',
          text: 'Последовательное изучение тем от основ к сложным задачам.',
        },
        {
          _key: 'diagStep2',
          title: 'Практика и закрепление',
          text: 'Вебинары, задания и применение знаний на практике.',
        },
        {
          _key: 'diagStep3',
          title: 'Поддержка наставника',
          text: 'Разбор сложных вопросов и помощь на пути к цели.',
        },
      ],
    }),
  ],
  preview: { select: { title: 'title' } },
})
