import {defineConfig, type SchemaTypeDefinition} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import schemaTypes from './sanity/math-cms/schemas/schemaTypes'

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
                      .title('Отзывы')
                      .schemaType('review')
                      .child(S.documentTypeList('review').title('Отзывы')),
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
                      .title('Тексты страницы')
                      .id('homePage')
                      .child(
                        S.document()
                          .schemaType('homePage')
                          .documentId('homePage')
                      ),
                    S.listItem()
                      .title('Наставники')
                      .schemaType('teacher')
                      .child(S.documentTypeList('teacher').title('Наставники')),
                    S.listItem()
                      .title('Статистика')
                      .schemaType('stat')
                      .child(S.documentTypeList('stat').title('Статистика')),
                    S.listItem()
                      .title('Принципы')
                      .schemaType('principle')
                      .child(S.documentTypeList('principle').title('Принципы')),
                    S.listItem()
                      .title('Как проходят занятия (шаги)')
                      .schemaType('processStep')
                      .child(
                        S.documentTypeList('processStep').title('Шаги процесса')
                      ),
                  ])
              ),
            S.listItem()
              .title('Страница курса (/)')
              .id('coursePage')
              .child(
                S.list()
                  .title('Страница курса (/)')
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
  },
  document: {
    newDocumentOptions: (prev, {creationContext}) => {
      if (creationContext.type === 'global') {
        return prev.filter(
          (templateItem) =>
            templateItem.templateId !== 'siteSettings' &&
            templateItem.templateId !== 'homePage'
        )
      }
      return prev
    },
    actions: (prev, {schemaType}) => {
      if (schemaType === 'siteSettings' || schemaType === 'homePage') {
        return prev.filter(
          ({action}) => action !== 'delete' && action !== 'duplicate'
        )
      }
      return prev
    },
  },
})
