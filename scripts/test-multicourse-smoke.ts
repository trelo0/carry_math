/**
 * Smoke: мультикурс — Sanity audit + NULL course_id в БД.
 * npx tsx scripts/test-multicourse-smoke.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAdminClient } from '../src/lib/supabase/admin';
import {
  flattenCourseLessons,
  getDistrictCourseContent,
  listDistrictCourseSummaries,
} from '../src/lib/studio/courseContent';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
    }
  }
}

let failed = 0;

function ok(name: string): void {
  console.log(`  ok ${name}`);
}

function warn(name: string, detail: string): void {
  console.log(`  warn ${name}: ${detail}`);
}

function fail(name: string, detail: string): void {
  failed += 1;
  console.log(`  FAIL ${name}: ${detail}`);
}

async function auditSanityLessonIds(): Promise<void> {
  const summaries = await listDistrictCourseSummaries().catch(() => []);
  const idToCourses = new Map<string, string[]>();
  for (const summary of summaries) {
    const content = await getDistrictCourseContent(summary.slug).catch(() => null);
    if (!content) continue;
    for (const lesson of flattenCourseLessons(content)) {
      const id = lesson.sanityId?.trim();
      if (!id) continue;
      const list = idToCourses.get(id) ?? [];
      list.push(summary.slug);
      idToCourses.set(id, list);
    }
  }
  const dupes = [...idToCourses.entries()].filter(([, slugs]) => slugs.length > 1);
  if (dupes.length > 0) {
    fail(
      'sanity-lesson-ids-unique',
      `${dupes.length} id в нескольких курсах (пример: ${dupes[0]![0]})`,
    );
    return;
  }
  ok(`sanity-lesson-ids (${idToCourses.size} ids)`);
}

async function reportNullCount(
  label: string,
  count: number | null,
  error: { message?: string } | null,
): Promise<void> {
  if (error) {
    warn(label, String(error.message ?? error));
    return;
  }
  const n = count ?? 0;
  if (n > 0) warn(label, `${n} rows with course_id null`);
  else ok(label);
}

async function dbNullCourseIds(admin: ReturnType<typeof createAdminClient>): Promise<void> {
  const progress = await admin
    .from('course_lesson_student_progress')
    .select('*', { count: 'exact', head: true })
    .not('sanity_lesson_id', 'is', null)
    .is('course_id', null);
  await reportNullCount('progress course_id', progress.count, progress.error);

  const access = await admin
    .from('course_lesson_access')
    .select('*', { count: 'exact', head: true })
    .not('sanity_lesson_id', 'is', null)
    .is('course_id', null);
  await reportNullCount('access course_id', access.count, access.error);

  const packages = await admin
    .from('lesson_packages')
    .select('*', { count: 'exact', head: true })
    .eq('product', 'course')
    .is('course_id', null);
  await reportNullCount('course packages course_id', packages.count, packages.error);

  const sessions = await admin
    .from('sanity_lesson_sessions')
    .select('*', { count: 'exact', head: true })
    .not('sanity_lesson_id', 'is', null)
    .is('course_id', null);
  await reportNullCount('sessions course_id', sessions.count, sessions.error);
}

async function main(): Promise<void> {
  console.log('test-multicourse-smoke');
  await auditSanityLessonIds();
  try {
    const admin = createAdminClient();
    await dbNullCourseIds(admin);
  } catch (e) {
    warn('database', String(e));
  }
  if (failed > 0) {
    console.error(`\nfailed: ${failed}`);
    process.exit(1);
  }
  console.log('\ntest-multicourse-smoke: ok');
}

void main();
