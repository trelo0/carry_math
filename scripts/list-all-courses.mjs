/** Список всех документов курсов (districtCourse и course) */

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

async function listAllCourses() {
  try {
    const docs = await client.fetch(`
      *[_type in ["districtCourse", "course"]] {
        _id,
        _type,
        title,
        "slug": slug.current
      }
    `);

    console.log('All course documents:');
    if (docs.length === 0) {
      console.log('  (none)');
    } else {
      docs.forEach((doc) => {
        console.log(`- ID: ${doc._id}`);
        console.log(`  Type: ${doc._type}`);
        console.log(`  Title: ${doc.title}`);
        console.log(`  Slug: ${doc.slug || 'no slug'}`);
        console.log();
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

listAllCourses();
