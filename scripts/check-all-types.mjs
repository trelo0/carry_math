/** Проверить все типы документов с slug kurs-district */

import { createClient } from '@sanity/client';

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || '2hngrocd';
const dataset = 'production';

const client = createClient({
  projectId,
  dataset,
  apiVersion: '2024-01-01',
  useCdn: false,
  perspective: 'raw', // Включаем draft
  token: process.env.SANITY_API_WRITE_TOKEN,
});

async function checkAll() {
  try {
    console.log('Checking with raw perspective (includes drafts)...');
    
    const docs = await client.fetch(`
      *[slug.current == "kurs-district"] {
        _id,
        _type,
        title,
        "slug": slug.current,
        purchaseScenarios
      }
    `);

    if (docs.length > 0) {
      console.log('Found documents:');
      docs.forEach((doc) => {
        console.log(`- ID: ${doc._id}`);
        console.log(`  Type: ${doc._type}`);
        console.log(`  Title: ${doc.title}`);
        console.log(`  Slug: ${doc.slug}`);
        console.log(`  Has purchaseScenarios: ${!!doc.purchaseScenarios}`);
      });
    } else {
      console.log('❌ No documents found with slug kurs-district');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkAll();
