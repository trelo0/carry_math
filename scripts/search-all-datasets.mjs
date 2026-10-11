/** Поиск документов по названию во всех датасетах */

import { createClient } from '@sanity/client';

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || '2hngrocd';
const datasets = ['production', 'development', 'staging'];

async function searchAllDatasets() {
  for (const dataset of datasets) {
    try {
      const client = createClient({
        projectId,
        dataset,
        apiVersion: '2024-01-01',
        useCdn: false,
        token: process.env.SANITY_API_WRITE_TOKEN,
      });

      const docs = await client.fetch(`
        *[title match "Вне" || title match "Математика"] {
          _id,
          _type,
          title,
          "slug": slug.current
        }
      `);

      if (docs.length > 0) {
        console.log(`Dataset: ${dataset}`);
        docs.forEach((doc) => {
          console.log(`  - ID: ${doc._id}`);
          console.log(`    Type: ${doc._type}`);
          console.log(`    Title: ${doc.title}`);
          console.log(`    Slug: ${doc.slug || 'no slug'}`);
        });
        console.log();
      }
    } catch (error) {
      console.log(`Dataset ${dataset}: ${error.message}`);
    }
  }
}

searchAllDatasets();
