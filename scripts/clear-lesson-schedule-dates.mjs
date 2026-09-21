/**
 * Очищает scheduledAt и lessonDate у всех districtCourseLesson в Sanity.
 * npm run clear:lesson-dates
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@sanity/client';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
    }
  }
}

const token = process.env.SANITY_API_WRITE_TOKEN;
if (!token) {
  console.error('SANITY_API_WRITE_TOKEN не задан в .env.local');
  process.exit(1);
}

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '2hngrocd',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production',
  apiVersion: process.env.NEXT_PUBLIC_SANITY_API_VERSION ?? '2023-03-17',
  token,
  useCdn: false,
});

const ids = await client.fetch(
  `*[_type == "districtCourseLesson" && (defined(scheduledAt) || defined(lessonDate))]._id`,
);

if (ids.length === 0) {
  console.log('Нет занятий с датами — нечего очищать.');
  process.exit(0);
}

let tx = client.transaction();
for (const id of ids) {
  tx = tx.patch(id, (patch) => patch.unset(['scheduledAt', 'lessonDate']));
}
await tx.commit();

console.log(`Очищены даты у ${ids.length} занятий.`);
