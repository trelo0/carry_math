import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import schemaTypes from './sanity/math-cms/schemas/schemaTypes'

export default defineConfig({
  name: 'default',
  title: 'math-cms',
  projectId: '2hngrocd',
  dataset: 'production',
  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title('Контент')
          .items([
            S.listItem()
              .title('Настройки сайта')
              .id('siteSettings')
              .child(
                S.document()
                  .schemaType('siteSettings')
                  .documentId('siteSettings')
              ),
            S.listItem()
              .title('Главная страница')
              .id('homePage')
              .child(
                S.document().schemaType('homePage').documentId('homePage')
              ),
            S.divider(),
            S.listItem()
              .title('Преподаватели')
              .schemaType('teacher')
              .child(S.documentTypeList('teacher').title('Преподаватели')),
            S.listItem()
              .title('Курсы')
              .schemaType('course')
              .child(S.documentTypeList('course').title('Курсы')),
            S.listItem()
              .title('Проблемы')
              .schemaType('problem')
              .child(S.documentTypeList('problem').title('Проблемы')),
            S.listItem()
              .title('Система достижения (шаги)')
              .schemaType('methodStep')
              .child(S.documentTypeList('methodStep').title('Шаги методики')),
            S.listItem()
              .title('Как проходят занятия (шаги)')
              .schemaType('processStep')
              .child(S.documentTypeList('processStep').title('Шаги процесса')),
          ]),
    }),
    visionTool(),
  ],
  schema: {
    types: schemaTypes,
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
