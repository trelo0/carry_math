/** Получить документ по ID с полным содержимым */

import { createClient } from '@sanity/client';

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || '2hngrocd';
const dataset = 'production';

const client = createClient({
  projectId,
  dataset,
  apiVersion: '2024-01-01',
  useCdn: false,
  perspective: 'raw',
  token: process.env.SANITY_API_WRITE_TOKEN,
});

async function getById() {
  try {
    console.log('Getting document by ID: districtCourse.district-course');
    
    const doc = await client.getDocument('districtCourse.district-course');
    
    if (doc) {
      console.log('✅ Document found:');
      console.log(JSON.stringify(doc, null, 2));
    } else {
      console.log('❌ Document not found');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

getById();
