/** Создать документ districtCourse с сценариями */

import { createClient } from '@sanity/client';

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '2hngrocd';
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production';

const client = createClient({
  projectId,
  dataset,
  apiVersion: '2024-01-01',
  useCdn: false,
  token: process.env.SANITY_API_WRITE_TOKEN,
});

const COURSE_ID = 'districtCourse.district-course';

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

async function createDistrictCourse() {
  try {
    console.log('Creating district course:', COURSE_ID);

    const result = await client.create({
      _id: COURSE_ID,
      _type: 'districtCourse',
      title: 'Вне системы: Математика 80+',
      cabinetEyebrow: 'Курс подготовки',
      description: 'Курс подготовки к ЦТ по математике',
      publicationStatus: 'published',
      slug: {
        _type: 'slug',
        current: 'kurs-district',
      },
      pricing: {
        priceByn: 180,
        grantedLessons: 8,
      },
      purchaseScenarios,
    });

    console.log('✅ Course created successfully!');
    console.log('Document ID:', result._id);
    console.log('Created at:', result._createdAt);
  } catch (error) {
    console.error('❌ Error creating course:', error.message);
    process.exit(1);
  }
}

createDistrictCourse();
