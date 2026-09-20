import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from 'next-sanity';

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(resolve(process.cwd(), '.env.local'));

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '2hngrocd';
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production';
const token = process.env.SANITY_API_READ_TOKEN || process.env.SANITY_API_WRITE_TOKEN;

const clientPublished = createClient({
  projectId,
  dataset,
  apiVersion: '2023-03-17',
  useCdn: false,
  perspective: 'published',
  token,
});

const clientDrafts = createClient({
  projectId,
  dataset,
  apiVersion: '2023-03-17',
  useCdn: false,
  perspective: 'drafts',
  token,
});

const clientRaw = createClient({
  projectId,
  dataset,
  apiVersion: '2023-03-17',
  useCdn: false,
  token,
});

const courseQuery = `*[_type == "districtCourse" && slug.current == $slug][0]{
  _id,
  title,
  "slug": slug.current,
  "moduleRefs": count(modules),
  "modules": modules[]->{
    _id,
    title,
    color,
    sortOrder,
    "lessons": lessons[]->{
      _id,
      title,
      lessonNumber,
      moduleOrder,
      publicationStatus
    }
  }
}`;

const pricingQuery = `*[_type == "cabinetSettings" && _id == "cabinetSettings"][0]{
  courseOffer,
  "teacherCount": count(teachers),
  teachers[]{ teacherId, name }
}`;

const listQuery = `*[_type == "districtCourse"]{ _id, title, "slug": slug.current, publicationStatus, "mods": count(modules) }`;

const countsQuery = `{
  "courses": count(*[_type == "districtCourse"]),
  "modules": count(*[_type == "districtModule"]),
  "lessons": count(*[_type == "districtCourseLesson"]),
  "settings": count(*[_type == "cabinetSettings"])
}`;

const byIdQuery = `*[_id == "districtCourse.district-course"][0]{ _id, _type, title, "slug": slug.current }`;

const clientPublic = createClient({
  projectId,
  dataset,
  apiVersion: '2023-03-17',
  useCdn: false,
  perspective: 'published',
});

const [coursePub, courseDrafts, courseRaw, pricing, courses, counts, byId, coursePublic] = await Promise.all([
  clientPublished.fetch(courseQuery, { slug: 'district-course' }),
  clientDrafts.fetch(courseQuery, { slug: 'district-course' }),
  clientRaw.fetch(courseQuery, { slug: 'district-course' }),
  clientPublished.fetch(pricingQuery),
  clientRaw.fetch(listQuery),
  clientRaw.fetch(countsQuery),
  clientRaw.fetch(byIdQuery),
  clientPublic.fetch(courseQuery, { slug: 'district-course' }),
]);

console.log('--- course PUBLIC (no token) ---');
console.log(JSON.stringify(coursePublic, null, 2));
console.log('--- course by _id ---');
console.log(JSON.stringify(byId, null, 2));
console.log('--- document counts ---');
console.log(JSON.stringify(counts, null, 2));
console.log('--- all districtCourse docs ---');
console.log(JSON.stringify(courses, null, 2));
console.log('--- course (previewDrafts) ---');
console.log(JSON.stringify(courseDrafts, null, 2));
console.log('--- course (published perspective) ---');
console.log(JSON.stringify(coursePub, null, 2));
console.log('--- course (raw) ---');
console.log(JSON.stringify(courseRaw, null, 2));
console.log('--- pricing ---');
console.log(JSON.stringify(pricing, null, 2));
