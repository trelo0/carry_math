import { defineField, defineType, defineArrayMember } from 'sanity'

const purchaseScenarioCardFields = [
  defineField({
    name: 'title',
    title: 'Заголовок',
    type: 'string',
    validation: (Rule) => Rule.required(),
  }),
  defineField({
    name: 'description',
    title: 'Описание',
    type: 'text',
    rows: 3,
    validation: (Rule) => Rule.required(),
  }),
  defineField({
    name: 'benefits',
    title: 'Преимущества',
    description: 'Список преимуществ (обычно 3-4 пункта)',
    type: 'array',
    of: [defineArrayMember({ type: 'string' })],
    validation: (Rule) => Rule.required().min(1),
  }),
  defineField({
    name: 'buttonLabel',
    title: 'Текст кнопки',
    type: 'string',
    validation: (Rule) => Rule.required(),
  }),
  defineField({
    name: 'subtitle',
    title: 'Подпись',
    description: 'Дополнительная подпись, поясняющая кому подходит этот формат',
    type: 'text',
    rows: 2,
  }),
]

function purchaseScenarioMode(parent: { mode?: string } | undefined): string | undefined {
  return parent?.mode
}

export default defineType({
  name: 'districtCourse',
  title: 'Настройки курса',
  type: 'document',
  groups: [
    { name: 'main', title: 'Курс', default: true },
    { name: 'access', title: 'Доступ' },
    { name: 'staff', title: 'Сотрудники' },
    { name: 'pricing', title: 'Карточка оплаты' },
    { name: 'preview', title: 'Превью в кабинете' },
  ],
  fields: [
    defineField({
      name: 'title',
      title: 'Название курса',
      type: 'string',
      group: 'main',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'cabinetEyebrow',
      title: 'Заголовок курса',
      description: 'Короткий заголовок над названием в кабинете',
      type: 'string',
      group: 'main',
      initialValue: 'Курс подготовки',
    }),
    defineField({
      name: 'description',
      title: 'Описание курса',
      type: 'text',
      rows: 4,
      group: 'main',
    }),
    defineField({
      name: 'coverImage',
      title: 'Обложка курса',
      type: 'image',
      options: { hotspot: true },
      group: 'main',
    }),
    defineField({
      name: 'curator',
      title: 'Преподаватель (имя в кабинете)',
      description:
        'Только для отображения имени на сайте/в кабинете. Не влияет на назначение в боте.',
      type: 'reference',
      to: [{ type: 'teacher' }],
      group: 'staff',
    }),
    defineField({
      name: 'curatorTelegramId',
      title: 'Куратор (Telegram ID)',
      description:
        'Число из админ-бота → Пользователи → человек с ролью curator (поле telegram_id). При покупке курса этот куратор автоматически привязывается к ученику (домашки, жизни). Это не преподаватель: преподаватель — имя на экране, куратор — кто ведёт ученика в Telegram. Пусто — берётся defaultCuratorTelegramId из «Кабинет → Цены».',
      type: 'number',
      group: 'staff',
    }),
    defineField({
      name: 'checkTelegramId',
      title: 'Проверяющий ДЗ (Telegram ID)',
      description:
        'Сотрудник с ролью check в боте. Проверяет домашние задания по этому курсу (не ведёт эфиры и не куратор). После сохранения документа назначение подтянется в базу при следующей синхронизации курса. Можно также назначить в админ-боте: Обучение → Курс → Сотрудники курса.',
      type: 'number',
      group: 'staff',
    }),
    defineField({
      name: 'deliveryFormat',
      title: 'Формат обучения',
      type: 'string',
      group: 'main',
      initialValue: 'Онлайн',
    }),

    defineField({
      name: 'pricing',
      title: 'Карточка оплаты в кабинете',
      description: 'Данные для блока «Оплата курса». Без цены и числа занятий карточка не показывается.',
      type: 'object',
      group: 'pricing',
      options: { collapsible: false },
      fields: [
        defineField({
          name: 'priceByn',
          title: 'Цена (BYN)',
          type: 'number',
          validation: (Rule) => Rule.min(0),
        }),
        defineField({
          name: 'grantedLessons',
          title: 'Количество занятий',
          description: 'Сколько занятий выдаётся после оплаты.',
          type: 'number',
          validation: (Rule) => Rule.integer().min(1),
        }),
        defineField({
          name: 'cardText',
          title: 'Текст в карточке',
          description: 'Короткое описание под названием на карточке оплаты (не путать с описанием курса).',
          type: 'text',
          rows: 3,
        }),
      ],
    }),

    // Legacy flat fields — читаем в коде с fallback, скрыты в Studio
    defineField({
      name: 'priceByn',
      title: 'Цена (legacy)',
      type: 'number',
      hidden: true,
    }),
    defineField({
      name: 'grantedLessons',
      title: 'Занятия (legacy)',
      type: 'number',
      hidden: true,
    }),

    defineField({
      name: 'cabinetPreviewInside',
      title: 'Что внутри курса',
      description: 'Карточки на экране превью: заголовок + короткое описание (обычно 4 штуки).',
      type: 'array',
      group: 'preview',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'cabinetPreviewInsideItem',
          fields: [
            defineField({
              name: 'title',
              title: 'Заголовок',
              type: 'string',
              validation: (Rule) => Rule.required(),
            }),
            defineField({
              name: 'description',
              title: 'Описание',
              type: 'text',
              rows: 2,
            }),
          ],
          preview: {
            select: { title: 'title', subtitle: 'description' },
          },
        }),
      ],
    }),
    defineField({
      name: 'cabinetPreviewAfterEnrollment',
      title: 'О курсе (legacy)',
      type: 'text',
      rows: 3,
      hidden: true,
    }),
    defineField({
      name: 'cabinetPreviewAudience',
      title: 'Кому подойдёт (legacy)',
      type: 'text',
      rows: 3,
      hidden: true,
    }),
    defineField({
      name: 'modules',
      title: 'Модули программы',
      description: 'Не заполняйте вручную. Модули создаются слева: Курс → Модули → «+».',
      type: 'array',
      group: 'main',
      hidden: true,
      of: [
        defineArrayMember({
          type: 'reference',
          weak: true,
          to: [{ type: 'districtModule' }],
        }),
      ],
    }),
    defineField({
      name: 'homeworkIntro',
      title: 'Текст блока домашних заданий',
      type: 'text',
      rows: 3,
      hidden: true,
    }),
    defineField({
      name: 'cabinetPreviewImage',
      title: 'Картинка превью',
      type: 'image',
      hidden: true,
    }),
    defineField({
      name: 'showInCatalog',
      title: 'Доступен для новых учеников',
      description:
        'Если выключено — курс не показывается в каталоге и его нельзя купить. Ученики с уже оплаченным пакетом или зачислением по-прежнему видят курс в кабинете.',
      type: 'boolean',
      group: 'access',
      initialValue: true,
    }),
    defineField({
      name: 'courseClosed',
      title: 'Закрыть курс',
      description:
        'Если включено — курс полностью скрывается из кабинета для всех, включая тех, кто покупал раньше. Остаётся только запись в истории оплат.',
      type: 'boolean',
      group: 'access',
      initialValue: false,
    }),
    defineField({
      name: 'slug',
      title: 'Код курса (slug)',
      description:
        'Обязательно. Нажмите Generate после названия (например: algebra-2026). Нужен для оплаты и ссылок.',
      type: 'slug',
      group: 'main',
      options: { source: 'title', maxLength: 96 },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'publicationStatus',
      title: 'Статус публикации',
      type: 'string',
      hidden: true,
      initialValue: 'published',
    }),

    defineField({
      name: 'purchaseScenarios',
      title: 'Сценарии покупки',
      description:
        'Режим «Без выбора» — оплата без окна формата (старт с начала по умолчанию). Иначе ученик подтверждает выбранный сценарий при первой покупке.',
      type: 'object',
      group: 'pricing',
      options: { collapsible: false },
      validation: (Rule) =>
        Rule.custom((value: { mode?: string; startFromBeginning?: { title?: string }; joinCurrent?: { title?: string } } | undefined) => {
          const mode = value?.mode ?? 'none'
          if (mode === 'none') return true
          if (mode === 'start_from_beginning' && !value?.startFromBeginning?.title) {
            return 'Заполните карточку «С начала»'
          }
          if (mode === 'join_current' && !value?.joinCurrent?.title) {
            return 'Заполните карточку «С активного модуля»'
          }
          if (mode === 'both') {
            if (!value?.startFromBeginning?.title || !value?.joinCurrent?.title) {
              return 'Заполните обе карточки для режима «Два сценария»'
            }
          }
          return true
        }),
      fields: [
        defineField({
          name: 'mode',
          title: 'Режим покупки',
          type: 'string',
          initialValue: 'none',
          options: {
            list: [
              { title: 'Без выбора (простая оплата)', value: 'none' },
              { title: 'Два сценария на выбор', value: 'both' },
              { title: 'Только «с начала»', value: 'start_from_beginning' },
              { title: 'Только «с активного модуля»', value: 'join_current' },
            ],
            layout: 'radio',
          },
          validation: (Rule) => Rule.required(),
        }),
        defineField({
          name: 'startFromBeginning',
          title: 'Карточка: с начала',
          type: 'object',
          fields: purchaseScenarioCardFields,
          hidden: ({ parent }) => {
            const mode = purchaseScenarioMode(parent)
            return !mode || mode === 'none' || mode === 'join_current'
          },
          options: {
            collapsible: true,
            collapsed: false,
          },
        }),
        defineField({
          name: 'joinCurrent',
          title: 'Карточка: с активного модуля',
          type: 'object',
          fields: purchaseScenarioCardFields,
          hidden: ({ parent }) => {
            const mode = purchaseScenarioMode(parent)
            return !mode || mode === 'none' || mode === 'start_from_beginning'
          },
          options: {
            collapsible: true,
            collapsed: false,
          },
        }),
      ],
    }),

    defineField({
      name: 'activeModuleOverride',
      title: 'Ручной выбор активного модуля',
      description: 'Если выбран, этот модуль будет считаться активным для сценария "Подключиться к курсу". Если не выбран — автоматическое определение по вебинарам.',
      type: 'reference',
      to: [{ type: 'districtModule' }],
      group: 'main',
    }),
  ],
  preview: {
    select: {
      title: 'title',
      headline: 'cabinetEyebrow',
      priceByn: 'pricing.priceByn',
      legacyPrice: 'priceByn',
      grantedLessons: 'pricing.grantedLessons',
      legacyLessons: 'grantedLessons',
      showInCatalog: 'showInCatalog',
      courseClosed: 'courseClosed',
    },
    prepare({ title, headline, priceByn, legacyPrice, grantedLessons, legacyLessons, showInCatalog, courseClosed }) {
      const price = typeof priceByn === 'number' ? priceByn : legacyPrice
      const lessons = typeof grantedLessons === 'number' ? grantedLessons : legacyLessons
      const bits = [
        courseClosed ? 'курс закрыт' : null,
        showInCatalog === false ? 'скрыт для новых' : null,
        headline,
        typeof price === 'number' ? `${price} BYN` : null,
        typeof lessons === 'number' ? `${lessons} зан.` : null,
      ].filter(Boolean)
      return { title: title ?? 'Курс', subtitle: bits.join(' · ') || undefined }
    },
  },
})
