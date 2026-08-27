import { defineField, defineType, defineArrayMember } from 'sanity'

export default defineType({
  name: 'initBlock',
  title: 'Курс — Инициация (цена и состав)',
  type: 'document',
  fields: [
    defineField({
      name: 'sectionTitle',
      title: 'Заголовок секции',
      description:
        'Например: «Время пройти инициацию». Последнее слово автоматически подсвечивается золотым.',
      type: 'string',
      initialValue: 'Время пройти инициацию',
    }),
    defineField({
      name: 'subtitle',
      title: 'Подзаголовок',
      type: 'string',
      initialValue: 'Полноценный абонемент на месяц',
    }),
    defineField({
      name: 'steps',
      title: 'Пункты абонемента',
      description:
        'Номера (01, 02…) добавляются автоматически. Иконка: search, pencil, sliders или chart.',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({
              name: 'icon',
              title: 'Иконка',
              type: 'string',
              options: {
                list: [
                  { title: 'Лупа (search)', value: 'search' },
                  { title: 'Карандаш (pencil)', value: 'pencil' },
                  { title: 'Слайдеры (sliders)', value: 'sliders' },
                  { title: 'График (chart)', value: 'chart' },
                ],
              },
              initialValue: 'chart',
            }),
            defineField({ name: 'title', title: 'Заголовок', type: 'string' }),
            defineField({
              name: 'lines',
              title: 'Строки описания',
              type: 'array',
              of: [defineArrayMember({ type: 'string' })],
            }),
          ],
          preview: { select: { title: 'title' } },
        }),
      ],
      initialValue: [
        {
          _key: 'initStep1',
          icon: 'search',
          title: '8 занятий с экспертом',
          lines: [
            '2 раза в неделю',
            '1 занятие ~90 минут',
            'Разбор ловушек ЦТ в режиме реального времени',
            'Решаем только то, что реально будет на ЦТ',
          ],
        },
        {
          _key: 'initStep2',
          icon: 'pencil',
          title: 'Ручная проверка домашних заданий',
          lines: [
            'Поддержка, мотивация и контроль 24/7',
            'Личный куратор в Telegram с развернутыми комментариями к домашнему заданию — он разбирает каждую твою ошибку',
          ],
        },
        {
          _key: 'initStep3',
          icon: 'sliders',
          title: 'Доступ к интерактивной платформе',
          lines: ['Улица Дистрикта с визуализацией твоего прогресса'],
        },
        {
          _key: 'initStep4',
          icon: 'chart',
          title: 'Оружейная комната',
          lines: ['Шпаргалки, чек-листы и материалы по всем темам ЦТ'],
        },
      ],
    }),
    defineField({
      name: 'priceLabel',
      title: 'Подпись над ценой',
      type: 'string',
      initialValue: 'Стоимость',
    }),
    defineField({
      name: 'priceValue',
      title: 'Цена',
      description: 'Например: «180 BYN»',
      type: 'string',
      initialValue: '180 BYN',
    }),
    defineField({
      name: 'pricePeriod',
      title: 'Подпись под ценой',
      type: 'string',
      initialValue: 'за один месяц подготовки',
    }),
    defineField({
      name: 'priceNote',
      title: 'Примечание (возврат)',
      type: 'text',
      rows: 2,
      initialValue: '100% возврат после первого занятия, если формат не подошёл',
    }),
    defineField({
      name: 'buttonText',
      title: 'Текст кнопки записи',
      type: 'string',
      initialValue: 'Записаться на курс',
    }),
  ],
  preview: {
    select: { title: 'sectionTitle' },
  },
})
