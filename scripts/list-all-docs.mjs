/** Список всех типов документов в Sanity */

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

async function listAllDocs() {
  try {
    const docs = await client.fetch(`
      *[]{
        _type,
        title,
        slug
      }
    `);

    console.log('All documents in Sanity:');
    const byType = {};
    docs.forEach((doc) => {
      if (!byType[doc._type]) byType[doc._type] = [];
      byType[doc._type].push(doc);
    });

    Object.keys(byType).forEach((type) => {
      console.log(`\nType: ${type}`);
      byType[type].forEach((doc) => {
        console.log(`  - ${doc.slug ? doc.slug : 'no slug'}: ${doc.title || 'no title'}`);
      });
    });
  } catch (error) {
    console.error('Error:', error.message);
  }
}

listAllDocs();
