import {defineConfig} from 'sanity'
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
    types: schemaTypes as any,
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
