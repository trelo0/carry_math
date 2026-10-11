/** Добавить сценарии покупки в существующий документ по ID */

import { createClient } from '@sanity/client';

const DATASET = 'production'; // Sanity Studio использует production
const COURSE_ID = 'districtCourse.district-course';

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || '2hngrocd';
const dataset = DATASET || process.env.NEXT_PUBLIC_SANITY_DATASET || 'production';

const client = createClient({
  projectId,
  dataset,
  apiVersion: '2024-01-01',
  useCdn: false,
  token: process.env.SANITY_API_WRITE_TOKEN,
});

const purchaseScenarios = {
  startFromBeginning: {
    title: 'Начать с начала',
    subtitle: 'Последовательное обучение',
    description: 'Пройдите курс с первого занятия по порядку. Идеально для тех, кто хочет систематическую подготовку.',
    benefits: [
      'Полное понимание структуры курса',
      'Последовательное усвоение материала',
      'Каждый урок опирается на предыдущий',
      'Рекомендуется для начинающих',
    ],
    buttonLabel: 'Начать обучение',
  },
  joinCurrent: {
    title: 'Подключиться к курсу',
    subtitle: 'Присоединиться к текущему модулю',
    description: 'Начните обучение с текущего активного модуля. Предыдущие модули будут доступны в архиве.',
    benefits: [
      'Начинаете с актуальной темы',
      'Архив всех пройденных модулей',
      'Не теряете время на пройденное',
      'Гибкий формат для опытных учеников',
    ],
    buttonLabel: 'Подключиться',
  },
};

async function patchCourse() {
  try {
    console.log('Getting course by ID:', COURSE_ID);
    
    const existing = await client.getDocument(COURSE_ID);
    if (!existing) {
      console.log('❌ Document not found');
      console.log('Available datasets: checking...');
      
      // Попробуем найти в других датасетах
      const datasets = ['production', 'development', 'staging'];
      for (const ds of datasets) {
        try {
          const testClient = createClient({
            projectId,
            dataset: ds,
            apiVersion: '2024-01-01',
            useCdn: false,
            token: process.env.SANITY_API_WRITE_TOKEN,
          });
          const doc = await testClient.getDocument(COURSE_ID);
          if (doc) {
            console.log(`✅ Found in dataset: ${ds}`);
            console.log(`Title: ${doc.title}`);
            console.log(`Slug: ${doc.slug?.current}`);
            console.log(`Type: ${doc._type}`);
            return;
          }
        } catch (e) {
          // ignore
        }
      }
      return;
    }

    console.log('✅ Found document:');
    console.log(`  Title: ${existing.title}`);
    console.log(`  Slug: ${existing.slug?.current}`);
    console.log(`  Type: ${existing._type}`);

    if (existing._type !== 'districtCourse') {
      console.log('❌ Document is not districtCourse type');
      return;
    }

    console.log('Adding purchaseScenarios...');
    
    const result = await client.patch(COURSE_ID).set({ purchaseScenarios }).commit();

    console.log('✅ Purchase scenarios added successfully!');
    console.log('Document ID:', result._id);
    console.log('Updated at:', result._updatedAt);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

patchCourse();
