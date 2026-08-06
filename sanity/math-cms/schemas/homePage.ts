import { defineField, defineType, defineArrayMember } from 'sanity'

export default defineType({
  name: 'homePage',
  title: 'Главная страница',
  type: 'document',
  fields: [
    defineField({
      name: 'heroEyebrow',
      title: 'Hero — надзаголовок',
      description:
        'Например: «Онлайн-школа». Название школы выводится отдельно — крупно под надзаголовком; если добавить его сюда, оно будет обрезано.',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'heroTitle',
      title: 'Hero — главный заголовок',
      description: 'Например: Готовим победителей',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'heroDescription',
      title: 'Hero — описание',
      type: 'text',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'sectionTeachersTitle',
      title: 'Заголовок секции наставников',
      description: 'Например: «Наши наставники» — слово «наставники» автоматически подсвечивается оранжевым.',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'sectionTeachersSubtitle',
      title: 'Подзаголовок секции наставников',
      description: 'Например: «Выбери своего и начни побеждать.»',
      type: 'string',
      initialValue: 'Выбери своего и начни побеждать.',
    }),
    defineField({
      name: 'sectionPrinciplesTitle',
      title: 'Заголовок секции принципов',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'sectionPrinciplesSubtitle',
      title: 'Подзаголовок секции принципов',
      type: 'string',
    }),
    defineField({
      name: 'sectionProcessTitle',
      title: 'Заголовок секции «Как проходят занятия»',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'sectionProcessSubtitle',
      title: 'Подзаголовок секции «Как проходят занятия»',
      type: 'string',
    }),
    defineField({
      name: 'diagnosticEyebrow',
      title: 'Диагностика — надзаголовок',
      description: 'Например: «Диагностика способностей»',
      type: 'string',
      initialValue: 'Диагностика способностей',
    }),
    defineField({
      name: 'diagnosticTitle',
      title: 'Диагностика — заголовок',
      description: 'Например: «В чём твоя сильная сторона?»',
      type: 'string',
      initialValue: 'В чём твоя сильная сторона?',
    }),
    defineField({
      name: 'diagnosticText',
      title: 'Диагностика — описание',
      type: 'text',
      initialValue:
        'Авторская диагностика подберёт направление под твой стиль мышления. Без подготовки и «правильных ответов» — только твои реальные способности.',
    }),
    defineField({
      name: 'diagnosticButtonText',
      title: 'Диагностика — текст кнопки',
      type: 'string',
      initialValue: 'Пройти диагностику',
    }),
    defineField({
      name: 'diagnosticSteps',
      title: 'Диагностика — пункты',
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
})
