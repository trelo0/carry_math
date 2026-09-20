import {defineConfig, type SchemaTypeDefinition} from 'sanity'
import {structureTool, type StructureBuilder} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import schemaTypes from './sanity/math-cms/schemas/schemaTypes'

function coursesStructure(S: StructureBuilder) {
  return S.documentTypeList('districtCourse')
    .title('Курсы')
    .child((courseId) =>
      S.list()
        .title('Курс')
        .items([
          S.listItem()
            .title('Настройки курса')
            .child(S.document().schemaType('districtCourse').documentId(courseId)),
          S.listItem()
            .title('Модули')
            .child(
              S.documentTypeList('districtModule')
                .title('Модули')
                .filter('_type == "districtModule" && course._ref == $courseId')
                .params({courseId})
                .defaultOrdering([{field: 'sortOrder', direction: 'asc'}])
                .initialValueTemplates([
                  S.initialValueTemplateItem('districtModule-in-course', {courseId}),
                ])
                .child((moduleId) =>
                  S.list()
                    .title('Модуль')
                    .items([
                      S.listItem()
                        .title('Настройки модуля')
                        .child(S.document().schemaType('districtModule').documentId(moduleId)),
                      S.listItem()
                        .title('Занятия')
                        .child(
                          S.documentTypeList('districtCourseLesson')
                            .title('Занятия')
                            .filter('_type == "districtCourseLesson" && module._ref == $moduleId')
                            .params({moduleId})
                            .defaultOrdering([{field: 'moduleOrder', direction: 'asc'}])
                            .initialValueTemplates([
                              S.initialValueTemplateItem('districtCourseLesson-in-module', {moduleId}),
                            ]),
                        ),
                    ]),
                ),
            ),
        ]),
    )
}

export default defineConfig({
  name: 'default',
  title: 'math-cms',
  projectId: '2hngrocd',
  dataset: 'production',
  basePath: '/studio',
  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title('Контент')
          .items([
            S.listItem()
              .title('Главная страница (/)')
              .id('mainPage')
              .child(
                S.list()
                  .title('Главная страница (/)')
                  .items([
                    S.listItem()
                      .title('Hero-блок')
                      .child(
                        S.document()
                          .schemaType('courseHero')
                          .documentId('courseHero')
                      ),
                    S.listItem()
                      .title('Наставник')
                      .child(
                        S.document()
                          .schemaType('mentorBlock')
                          .documentId('mentorBlock')
                      ),
                    S.listItem()
                      .title('Программа обучения')
                      .child(
                        S.document()
                          .schemaType('programBlock')
                          .documentId('programBlock')
                      ),
                    S.listItem()
                      .title('Отзывы (заголовок секции)')
                      .child(
                        S.document()
                          .schemaType('reviewsBlock')
                          .documentId('reviewsBlock')
                      ),
                    S.listItem()
                      .title('Отзывы')
                      .schemaType('review')
                      .child(S.documentTypeList('review').title('Отзывы')),
                    S.listItem()
                      .title('Время пройти инициацию (цена)')
                      .child(
                        S.document()
                          .schemaType('initBlock')
                          .documentId('initBlock')
                      ),
                    S.listItem()
                      .title('FAQ (заголовок секции)')
                      .child(
                        S.document()
                          .schemaType('faqBlock')
                          .documentId('faqBlock')
                      ),
                    S.listItem()
                      .title('Вопросы FAQ')
                      .schemaType('faqItem')
                      .child(S.documentTypeList('faqItem').title('Вопросы FAQ')),
                    S.listItem()
                      .title('Не подошёл курс (развилка)')
                      .child(
                        S.document()
                          .schemaType('pathsBlock')
                          .documentId('pathsBlock')
                      ),
                  ])
              ),
            S.listItem()
              .title('Индивидуальные занятия (/individual)')
              .id('individualPage')
              .child(
                S.list()
                  .title('Индивидуальные занятия (/individual)')
                  .items([
                    S.listItem()
                      .title('Hero-блок')
                      .child(
                        S.document()
                          .schemaType('individualHeroBlock')
                          .documentId('individualHeroBlock')
                      ),
                    S.listItem()
                      .title('Наставники (заголовки секции)')
                      .child(
                        S.document()
                          .schemaType('teachersBlock')
                          .documentId('teachersBlock')
                      ),
                    S.listItem()
                      .title('Наставники (карточки)')
                      .schemaType('teacher')
                      .child(S.documentTypeList('teacher').title('Наставники')),
                    S.listItem()
                      .title('Принципы (заголовки секции)')
                      .child(
                        S.document()
                          .schemaType('principlesBlock')
                          .documentId('principlesBlock')
                      ),
                    S.listItem()
                      .title('Статистика')
                      .schemaType('stat')
                      .child(S.documentTypeList('stat').title('Статистика')),
                    S.listItem()
                      .title('Принципы')
                      .schemaType('principle')
                      .child(S.documentTypeList('principle').title('Принципы')),
                    S.listItem()
                      .title('Формат «Соло или команда»')
                      .child(
                        S.document()
                          .schemaType('formatsBlock')
                          .documentId('formatsBlock')
                      ),
                    S.listItem()
                      .title('Как проходят занятия (заголовки)')
                      .child(
                        S.document()
                          .schemaType('processBlock')
                          .documentId('processBlock')
                      ),
                    S.listItem()
                      .title('Как проходят занятия (шаги)')
                      .schemaType('processStep')
                      .child(
                        S.documentTypeList('processStep').title('Шаги процесса')
                      ),
                    S.listItem()
                      .title('Время выбрать свой путь (запись)')
                      .child(
                        S.document()
                          .schemaType('choosePathBlock')
                          .documentId('choosePathBlock')
                      ),
                    S.listItem()
                      .title('В чём сильная сторона (диагностика)')
                      .child(
                        S.document()
                          .schemaType('diagnosticBlock')
                          .documentId('diagnosticBlock')
                      ),
                  ])
              ),
            S.divider(),
            S.listItem()
              .title('Кабинет')
              .id('cabinet')
              .child(
                S.list()
                  .title('Кабинет')
                  .items([
                    S.listItem()
                      .title('Курсы')
                      .child(coursesStructure(S)),
                    S.listItem()
                      .title('Цены')
                      .child(
                        S.document()
                          .schemaType('cabinetSettings')
                          .documentId('cabinetSettings')
                      ),
                  ])
              ),
            S.divider(),
            S.listItem()
              .title('Настройки сайта (общие)')
              .id('siteSettings')
              .child(
                S.document()
                  .schemaType('siteSettings')
                  .documentId('siteSettings')
              ),
          ]),
    }),
    visionTool(),
  ],
  schema: {
    types: schemaTypes as SchemaTypeDefinition[],
    templates: (prev) => [
      ...prev,
      {
        id: 'districtModule-in-course',
        title: 'Модуль',
        schemaType: 'districtModule',
        parameters: [{name: 'courseId', type: 'string'}],
        value: ({courseId}: {courseId: string}) => ({
          course: {_type: 'reference', _ref: courseId},
          color: '#4f7cff',
          sortOrder: 0,
        }),
      },
      {
        id: 'districtCourseLesson-in-module',
        title: 'Занятие',
        schemaType: 'districtCourseLesson',
        parameters: [{name: 'moduleId', type: 'string'}],
        value: ({moduleId}: {moduleId: string}) => ({
          module: {_type: 'reference', _ref: moduleId},
          lessonType: 'webinar',
          publicationStatus: 'published',
          moduleOrder: 1,
          contentChips: ['Теория', 'Разбор задач', 'Практика', 'Домашнее задание'],
        }),
      },
    ],
  },
  document: {
    newDocumentOptions: (prev, {creationContext}) => {
      if (creationContext.type === 'global') {
        return prev.filter(
          (templateItem) =>
            templateItem.templateId !== 'siteSettings' &&
            templateItem.templateId !== 'cabinetSettings',
        )
      }
      return prev
    },
    actions: (prev, {schemaType}) => {
      if (schemaType === 'siteSettings' || schemaType === 'cabinetSettings') {
        return prev.filter(
          ({action}) => action !== 'delete' && action !== 'duplicate'
        )
      }
      return prev
    },
  },
})
