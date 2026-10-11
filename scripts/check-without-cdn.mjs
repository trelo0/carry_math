/** Проверить без CDN */

import { createClient } from '@sanity/client';

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || '2hngrocd';
const dataset = 'production';

const client = createClient({
  projectId,
  dataset,
  apiVersion: '2024-01-01',
  useCdn: false, // Важно: без CDN
  token: process.env.SANITY_API_WRITE_TOKEN,
});

async function check() {
  try {
    console.log('Checking without CDN...');
    
    const doc = await client.fetch(`
      *[_type == "districtCourse" && slug.current == "kurs-district"][0] {
        _id,
        title,
        "slug": slug.current,
        purchaseScenarios
      }
    `);

    if (doc) {
      console.log('✅ Found:');
      console.log(`ID: ${doc._id}`);
      console.log(`Title: ${doc.title}`);
      console.log(`Slug: ${doc.slug}`);
      console.log(`Has purchaseScenarios: ${!!doc.purchaseScenarios}`);
    } else {
      console.log('❌ Not found');
      
      // Все документы districtCourse
      const all = await client.fetch(`*[_type == "districtCourse"]{ _id, title, "slug": slug.current }`);
      console.log('All districtCourse:', JSON.stringify(all, null, 2));
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

check();
