/** Получить данные курса по slug */

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

async function getCourseData(slug) {
  try {
    const course = await client.fetch(`
      *[_type == "course" && slug.current == $slug][0] {
        _id,
        title,
        description,
        "slug": slug.current,
        pricing,
        priceByn,
        grantedLessons
      }
    `, { slug });

    console.log('Course data:', JSON.stringify(course, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  }
}

getCourseData('kurs-district');
