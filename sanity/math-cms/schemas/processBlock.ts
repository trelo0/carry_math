import { defineField, defineType } from 'sanity'

export default defineType({
  name: 'processBlock',
  title: 'Индивидуальные — «Как проходят занятия» (заголовки)',
  description: 'Заголовки секции. Сами шаги — отдельные документы «Шаг процесса».',
  type: 'document',
  fields: [
    defineField({
      name: 'kicker',
      title: 'Надзаголовок (киккер)',
      type: 'string',
      initialValue: 'КВЕСТ 04 // КАК ПРОХОДИТ ОБУЧЕНИЕ :: ПРОТОКОЛ',
    }),
    defineField({
      name: 'sectionTitle',
      title: 'Заголовок секции',
      type: 'string',
      initialValue: 'Как проходит обучение',
    }),
    defineField({
      name: 'sectionSubtitle',
      title: 'Подзаголовок секции',
      type: 'string',
    }),
  ],
  preview: { select: { title: 'sectionTitle' } },
})
