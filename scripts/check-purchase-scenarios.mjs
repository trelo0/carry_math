/** Проверить загрузку purchaseScenarios для kurs-district */

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

async function checkScenarios() {
  try {
    // По документу с slug kurs-district
    const doc = await client.fetch(`
      *[_type == "districtCourse" && slug.current == "kurs-district"][0] {
        _id,
        title,
        "slug": slug.current,
        purchaseScenarios
      }
    `);

    if (doc) {
      console.log('Document found:');
      console.log(`ID: ${doc._id}`);
      console.log(`Title: ${doc.title}`);
      console.log(`Slug: ${doc.slug}`);
      console.log(`Has purchaseScenarios: ${!!doc.purchaseScenarios}`);
      if (doc.purchaseScenarios) {
        console.log('purchaseScenarios:', JSON.stringify(doc.purchaseScenarios, null, 2));
      }
    } else {
      console.log('Document not found with slug kurs-district');
      
      // Попробуем найти все districtCourse
      const all = await client.fetch(`*[_type == "districtCourse"]{ _id, title, "slug": slug.current }`);
      console.log('All districtCourse documents:');
      all.forEach((d) => {
        console.log(`  - ${d._id}: ${d.title} (${d.slug})`);
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkScenarios();
