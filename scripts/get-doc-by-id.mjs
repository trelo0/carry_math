/** Получить документ по ID */

import { createClient } from '@sanity/client';

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || '2hngrocd';
const dataset = 'production';

const client = createClient({
  projectId,
  dataset,
  apiVersion: '2024-01-01',
  useCdn: false,
  token: process.env.SANITY_API_WRITE_TOKEN,
});

async function getDoc() {
  try {
    const doc = await client.getDocument('districtCourse.district-course');
    
    if (doc) {
      console.log('Document found:');
      console.log(`ID: ${doc._id}`);
      console.log(`Type: ${doc._type}`);
      console.log(`Title: ${doc.title}`);
      console.log(`Slug: ${doc.slug?.current}`);
      console.log(`Has purchaseScenarios: ${!!doc.purchaseScenarios}`);
    } else {
      console.log('Document not found');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

getDoc();
