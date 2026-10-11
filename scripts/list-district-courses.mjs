/** Список всех districtCourse в Sanity */

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

async function listDistrictCourses() {
  try {
    const courses = await client.fetch(`
      *[_type == "districtCourse"] {
        _id,
        "slug": slug.current,
        title,
        pricing,
        priceByn,
        grantedLessons
      }
    `);

    console.log('District courses in Sanity:');
    if (courses.length === 0) {
      console.log('  (none)');
    } else {
      courses.forEach((course) => {
        console.log(`- ID: ${course._id}`);
        console.log(`  Slug: ${course.slug}`);
        console.log(`  Title: ${course.title}`);
        console.log(`  Price: ${course.priceByn} BYN`);
        console.log(`  Lessons: ${course.grantedLessons}`);
        console.log();
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

listDistrictCourses();
