/**
 * Идемпотентный импорт курса District в Sanity CMS.
 *
 * Создаёт: 1 курс, 7 модулей, 74 урока со stable _id.
 * Повторный запуск обновляет те же документы (createOrReplace).
 *
 * Требуется токен с правами записи:
 *   SANITY_API_WRITE_TOKEN=...  (Manage → API → Tokens → Editor)
 *
 * Запуск:
 *   npm run import:course
 *   npm run import:course -- --dry-run
 */

import { createClient } from '@sanity/client';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  COURSE,
  COURSE_ID,
  LESSONS,
  MODULES,
  lessonId,
  moduleForLesson,
  moduleOrderForLesson,
  scheduledAtFromDate,
} from './district-course-data.mjs';

const dryRun = process.argv.includes('--dry-run');

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
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
loadEnvFile(resolve(process.cwd(), '.env'));

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '2hngrocd';
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production';
const token = process.env.SANITY_API_WRITE_TOKEN;

if (!token && !dryRun) {
  console.error(
    'Ошибка: задайте SANITY_API_WRITE_TOKEN в .env.local (Sanity → Project → API → Tokens, роль Editor).',
  );
  console.error('Для проверки без записи: npm run import:course -- --dry-run');
  process.exit(1);
}

const client = createClient({
  projectId,
  dataset,
  apiVersion: '2023-03-17',
  token,
  useCdn: false,
});

function ref(id) {
  return { _type: 'reference', _ref: id };
}

function extractBlockFromTitle(title) {
  const match = title.match(/\((Блок[^)]+)\)/);
  return match ? match[1] : null;
}

function buildLessonDoc([n, date, block, title]) {
  const mod = moduleForLesson(n);
  const moduleOrder = moduleOrderForLesson(n);
  const curriculumBlock = block ?? extractBlockFromTitle(title) ?? undefined;
  return {
    _id: lessonId(n),
    _type: 'districtCourseLesson',
    title,
    lessonNumber: n,
    lessonDate: date,
    curriculumBlock,
    moduleOrder,
    sortOrder: n,
    module: mod ? ref(mod.id) : undefined,
    lessonType: 'webinar',
    publicationStatus: 'published',
    isTrialFree: n === 1,
    mandatoryHomework: true,
    scheduledAt: date ? scheduledAtFromDate(date) : undefined,
    description: curriculumBlock ? `[${curriculumBlock}] ${title}` : title,
  };
}

function buildModuleShell(mod) {
  return {
    _id: mod.id,
    _type: 'districtModule',
    title: mod.title,
    description: mod.period ? `Период: ${mod.period}` : undefined,
    period: mod.period,
    color: mod.color,
    sortOrder: mod.sortOrder,
    course: ref(COURSE_ID),
  };
}

function buildModuleDoc(mod) {
  const lessonRefs = mod.lessonNumbers.map((n, i) => ({
    _key: `l${n}`,
    ...ref(lessonId(n)),
  }));

  return {
    _id: mod.id,
    _type: 'districtModule',
    title: mod.title,
    description: mod.period ? `Период: ${mod.period}` : undefined,
    period: mod.period,
    color: mod.color,
    sortOrder: mod.sortOrder,
    course: ref(COURSE_ID),
    lessons: lessonRefs,
  };
}

function buildCourseShell() {
  return {
    _id: COURSE_ID,
    _type: 'districtCourse',
    title: COURSE.title,
    slug: { _type: 'slug', current: COURSE.slug },
    description: COURSE.description,
    publicationStatus: COURSE.publicationStatus,
  };
}

function buildCourseDoc() {
  const moduleRefs = MODULES.map((m) => ({
    _key: `m${m.sortOrder}`,
    ...ref(m.id),
  }));

  return {
    _id: COURSE_ID,
    _type: 'districtCourse',
    title: COURSE.title,
    slug: { _type: 'slug', current: COURSE.slug },
    description: COURSE.description,
    publicationStatus: COURSE.publicationStatus,
    modules: moduleRefs,
  };
}

async function commitDocs(docs, label) {
  const batchSize = 50;
  for (let i = 0; i < docs.length; i += batchSize) {
    const chunk = docs.slice(i, i + batchSize);
    const tx = client.transaction();
    for (const doc of chunk) {
      tx.createOrReplace(doc);
    }
    await tx.commit({ visibility: 'sync' });
    console.log(`${label}: ${Math.min(i + batchSize, docs.length)} / ${docs.length}`);
  }
}

async function main() {
  const lessonDocs = LESSONS.map(buildLessonDoc);
  const moduleDocs = MODULES.map(buildModuleDoc);
  const moduleShells = MODULES.map(buildModuleShell);
  const courseDoc = buildCourseDoc();
  const courseShell = buildCourseShell();

  console.log(`Проект: ${projectId} / ${dataset}`);
  console.log(`Курс: ${courseDoc.title}`);
  console.log(`Модулей: ${moduleDocs.length}, уроков: ${lessonDocs.length}`);

  if (dryRun) {
    console.log('\n[dry-run] Порядок: курс → модули → уроки → модули+уроки → курс+модули');
    console.log('[dry-run] Первый урок:', JSON.stringify(lessonDocs[0], null, 2));
    console.log('[dry-run] Первый модуль:', JSON.stringify(moduleDocs[0], null, 2));
    console.log('[dry-run] Курс:', JSON.stringify(courseDoc, null, 2));
    return;
  }

  // Sanity проверяет references: сначала родители, потом дети, потом связи.
  console.log('\n1/5 Курс (без модулей)...');
  await commitDocs([courseShell], 'курс');

  console.log('2/5 Модули (без уроков)...');
  await commitDocs(moduleShells, 'модули');

  console.log('3/5 Уроки (74)...');
  await commitDocs(lessonDocs, 'уроки');

  console.log('4/5 Модули + ссылки на уроки...');
  await commitDocs(moduleDocs, 'модули+уроки');

  console.log('5/5 Курс + ссылки на модули...');
  await commitDocs([courseDoc], 'курс+модули');

  const verify = await client.fetch(
    `{
      "course": *[_id == $courseId][0]{ title, "moduleCount": count(modules), publicationStatus },
      "modules": count(*[_type == "districtModule" && course._ref == $courseId]),
      "lessons": count(*[_type == "districtCourseLesson" && module->course._ref == $courseId])
    }`,
    { courseId: COURSE_ID },
  );

  console.log('\nПроверка после импорта:');
  console.log(JSON.stringify(verify, null, 2));

  if (verify.modules !== 7 || verify.lessons !== 74) {
    console.warn('⚠ Ожидалось 7 модулей и 74 урока — проверьте Studio.');
    process.exitCode = 1;
  } else {
    console.log('✓ Импорт завершён. Откройте /studio → «Курс District (кабинет)».');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
