/**
 * Проверка глобальной уникальности sanity id уроков между district-курсами.
 * npx tsx scripts/audit-sanity-lesson-ids.ts
 */

import { listDistrictCourseSummaries, getDistrictCourseContent } from '@/lib/studio/courseContent';
import { flattenCourseLessons } from '@/lib/studio/courseContent';

async function main() {
  const summaries = await listDistrictCourseSummaries();
  const byId = new Map<string, string[]>();

  for (const summary of summaries) {
    const content = await getDistrictCourseContent(summary.slug).catch(() => null);
    if (!content) continue;
    for (const lesson of flattenCourseLessons(content)) {
      const id = lesson.sanityId?.trim();
      if (!id) continue;
      const slugs = byId.get(id) ?? [];
      slugs.push(summary.slug);
      byId.set(id, slugs);
    }
  }

  const dupes = [...byId.entries()].filter(([, slugs]) => slugs.length > 1);
  if (dupes.length > 0) {
    console.error('Duplicate sanity_lesson_id across courses:');
    for (const [id, slugs] of dupes) {
      console.error(`  ${id}: ${slugs.join(', ')}`);
    }
    process.exit(1);
  }
  console.log('audit-sanity-lesson-ids: ok', byId.size, 'lesson ids');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
