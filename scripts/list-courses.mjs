/** Список всех курсов districtCourse в Sanity */

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

async function listCourses() {
  try {
    const courses = await client.fetch(`
      *[_type == "districtCourse"] {
        _id,
        slug,
        title
      }
    `);

    console.log('Courses in Sanity:');
    courses.forEach((course) => {
      console.log(`- ID: ${course._id}, Slug: ${course.slug}, Title: ${course.title}`);
    });
  } catch (error) {
    console.error('Error:', error.message);
  }
}

listCourses();
