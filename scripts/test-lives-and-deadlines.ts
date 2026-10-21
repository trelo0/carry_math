/**
 * Автопроверка жизней, заморозки, monthly restore (1–3), таймера ДЗ (Play),
 * сброса после full block + repurchase.
 *
 * npx tsx scripts/test-lives-and-deadlines.ts
 */

import { readFileSync } from 'node:fs';
import { createAdminClient } from '../src/lib/supabase/admin';
import { createCourse, enrollStudent } from '../src/lib/bot/education/courses';
import {
  adjustLives,
  getEnrollmentLives,
  grantBonusLife,
  initEnrollmentLives,
  isLivesTableError,
  monthlyRestoreLivesForEnrollment,
  moscowDayOfMonth,
  moscowPeriodKey,
  setCourseFullyBlocked,
  shouldPromptMonthlyLivesRestore,
} from '../src/lib/bot/education/lives';
import { resetCourseLearningForRepurchase } from '../src/lib/bot/education/course-access';
import { ensureCourseEnrollmentOnPurchase } from '../src/lib/bot/packages';
import { ensureHomeworkDeadlineStarted } from '../src/lib/bot/education/homework-deadline';
import { getDistrictCourseContent, flattenCourseLessons } from '../src/lib/studio/courseContent';
import { lessonHasHomework } from '../src/lib/bot/education/lesson-progress-calc';

for (const raw of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const match = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

const admin = createAdminClient();

const STU = 999999071;
const ADM = 999999072;
const CUR = 999999073;
const ALL = [STU, ADM, CUR];

let courseId = 0;
let passed = 0;
let failed = 0;
let skipped = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function skip(name: string, reason: string): void {
  skipped += 1;
  console.log(`  ⏭ ${name} — ${reason}`);
}

function mskDate(year: number, month: number, day: number, hour = 12): Date {
  // month 1–12; строим момент, который в МСК даёт нужный календарный день
  const utcApprox = new Date(Date.UTC(year, month - 1, day, hour - 3, 0, 0));
  return utcApprox;
}

async function cleanup(): Promise<void> {
  await admin.from('course_life_events').delete().in('telegram_id', ALL);
  await admin.from('course_enrollment_state').delete().in('telegram_id', ALL);
  await admin.from('course_lesson_student_progress').delete().in('telegram_id', ALL);
  await admin.from('course_lesson_access').delete().in('telegram_id', ALL);
  await admin.from('course_enrollments').delete().in('telegram_id', ALL);
  await admin.from('bot_members').delete().in('telegram_id', ALL);
  if (courseId) {
    await admin.from('courses').delete().eq('id', courseId);
    courseId = 0;
  }
}

function staticSourceChecks(): void {
  console.log('\n== Static: Play-only deadline start ==');
  const watchGate = readFileSync(
    new URL('../src/lib/bot/education/course-watch-gate.ts', import.meta.url),
    'utf8',
  );
  const cabinet = readFileSync(new URL('../src/lib/cabinet.ts', import.meta.url), 'utf8');

  const percentFn = watchGate.slice(
    watchGate.indexOf('export async function reportLessonWatchPercentWithGate'),
    watchGate.indexOf('export async function reportLessonMaterialOpenedWithGate'),
  );
  const materialFn = watchGate.slice(
    watchGate.indexOf('export async function reportLessonMaterialOpenedWithGate'),
  );
  const liveFn = watchGate.slice(
    watchGate.indexOf('export async function watchLiveWithAccessGate'),
    watchGate.indexOf('export async function reportLessonWatchPercentWithGate'),
  );
  const recFn = watchGate.slice(
    watchGate.indexOf('export async function watchRecordingWithAccessGate'),
    watchGate.indexOf('export async function watchLiveWithAccessGate'),
  );

  check('watch-live вызывает startDeadlineIfNeeded', liveFn.includes('startDeadlineIfNeeded'));
  check('watch-recording вызывает startDeadlineIfNeeded', recFn.includes('startDeadlineIfNeeded'));
  check('watch-percent НЕ стартует дедлайн', !percentFn.includes('startDeadlineIfNeeded'));
  check('material-open НЕ стартует дедлайн', !materialFn.includes('startDeadlineIfNeeded'));
  check(
    'cabinet lesson page НЕ вызывает ensureHomeworkDeadlineStarted',
    !cabinet.includes('ensureHomeworkDeadlineStarted'),
  );
}

async function testPromptWindow(): Promise<void> {
  console.log('\n== shouldPromptMonthlyLivesRestore: дни 1–3 МСК ==');

  // Гарантируем belowMax > 0 на время проверки окна
  const state = await getEnrollmentLives(admin, STU, courseId);
  if (!state || state.lives_current >= state.lives_max) {
    await adjustLives(admin, {
      telegramId: STU,
      courseId,
      delta: -1,
      reason: 'test: lower for prompt window',
      actorTelegramId: CUR,
      operationType: 'deduct',
      sanityLessonId: 'test-prompt-window-lesson',
    });
  }

  const y = Number(moscowPeriodKey().slice(0, 4));
  const m = Number(moscowPeriodKey().slice(5, 7));

  for (const day of [1, 2, 3]) {
    const r = await shouldPromptMonthlyLivesRestore(admin, mskDate(y, m, day));
    check(
      `день ${day}: prompt=true при belowMax>0`,
      r.day === day && r.belowMax > 0 && r.prompt === true,
      `day=${r.day} belowMax=${r.belowMax} prompt=${r.prompt}`,
    );
  }
  for (const day of [4, 5, 7, 15]) {
    const r = await shouldPromptMonthlyLivesRestore(admin, mskDate(y, m, day));
    check(
      `день ${day}: prompt=false`,
      r.day === day && r.prompt === false,
      `day=${r.day} prompt=${r.prompt}`,
    );
  }

  check('moscowDayOfMonth согласован', moscowDayOfMonth(mskDate(y, m, 3)) === 3);
}

async function testFreezeUnfreeze(): Promise<void> {
  console.log('\n== Freeze / +1 / monthly restore ==');

  // Обнулить жизни до max и снять блоки
  await admin
    .from('course_enrollment_state')
    .update({
      lives_current: 3,
      access_blocked: false,
      frozen_at: null,
      frozen_reason: null,
      fully_blocked: false,
      lives_zero_notified_at: null,
    })
    .eq('telegram_id', STU)
    .eq('course_id', courseId);

  // 3 списания → freeze
  for (let i = 1; i <= 3; i += 1) {
    await adjustLives(admin, {
      telegramId: STU,
      courseId,
      delta: -1,
      reason: `test deduct ${i}`,
      actorTelegramId: CUR,
      operationType: 'deduct',
      sanityLessonId: `test-deduct-${i}-${Date.now()}`,
    });
  }
  let s = await getEnrollmentLives(admin, STU, courseId);
  check('после 3 списаний lives=0', s?.lives_current === 0);
  check('после 3 списаний access_blocked', s?.access_blocked === true);

  // +1 → unfreeze
  s = await grantBonusLife(admin, {
    telegramId: STU,
    courseId,
    curatorTelegramId: CUR,
    reason: 'test +1 unfreeze',
  });
  check('+1 → lives=1', s.lives_current === 1);
  check('+1 → заморозка снята', s.access_blocked === false);

  // снова в 0
  await adjustLives(admin, {
    telegramId: STU,
    courseId,
    delta: -1,
    reason: 'test deduct again',
    actorTelegramId: CUR,
    operationType: 'deduct',
    sanityLessonId: `test-deduct-again-${Date.now()}`,
  });
  s = await getEnrollmentLives(admin, STU, courseId);
  check('снова 0 → freeze', s?.lives_current === 0 && s?.access_blocked === true);

  // monthly restore с уникальным period_key
  const periodKey = `test-${Date.now()}`;
  const restored = await monthlyRestoreLivesForEnrollment(admin, STU, courseId, periodKey);
  check('monthly restore → lives=max', restored.state.lives_current === restored.state.lives_max);
  check('monthly restore → unfreeze', restored.state.access_blocked === false);
  check('monthly restore changed', restored.restored === true);

  // идемпотентность
  const again = await monthlyRestoreLivesForEnrollment(admin, STU, courseId, periodKey);
  check('monthly restore идемпотентен', again.restored === false);
}

async function testFullyBlockedRepurchase(): Promise<void> {
  console.log('\n== Full block + repurchase reset ==');

  const sanityA = `test-lesson-a-${Date.now()}`;
  const sanityB = `test-lesson-b-${Date.now()}`;

  await admin.from('course_lesson_access').upsert(
    {
      telegram_id: STU,
      sanity_lesson_id: sanityA,
      access_status: 'available',
      source: 'package',
    },
    { onConflict: 'telegram_id,sanity_lesson_id' },
  );
  await admin.from('course_lesson_student_progress').upsert(
    {
      telegram_id: STU,
      sanity_lesson_id: sanityA,
      homework_status: 'approved',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'telegram_id,sanity_lesson_id' },
  );
  await admin.from('course_lesson_student_progress').upsert(
    {
      telegram_id: STU,
      sanity_lesson_id: sanityB,
      homework_status: 'pending',
      homework_deadline_at: new Date(Date.now() + 3600_000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'telegram_id,sanity_lesson_id' },
  );

  await admin
    .from('course_enrollment_state')
    .update({ lives_current: 0, access_blocked: true })
    .eq('telegram_id', STU)
    .eq('course_id', courseId);

  await setCourseFullyBlocked(admin, {
    telegramId: STU,
    courseId,
    adminTelegramId: ADM,
    reason: 'test full block',
    blocked: true,
  });
  let s = await getEnrollmentLives(admin, STU, courseId);
  check('fully_blocked=true', s?.fully_blocked === true);

  // Симулируем повторную оплату
  const enrolledCourseId = await ensureCourseEnrollmentOnPurchase(admin, STU, courseId);
  check('ensureCourseEnrollmentOnPurchase вернул courseId', enrolledCourseId === courseId);

  s = await getEnrollmentLives(admin, STU, courseId);
  check('после оплаты fully_blocked=false', s?.fully_blocked === false);
  check('после оплаты access_blocked=false', s?.access_blocked === false);
  check('после оплаты lives=max', s?.lives_current === s?.lives_max && (s?.lives_max ?? 0) > 0);

  const { data: progressLeft } = await admin
    .from('course_lesson_student_progress')
    .select('id')
    .eq('telegram_id', STU)
    .in('sanity_lesson_id', [sanityA, sanityB]);
  check('прогресс по тестовым урокам удалён', (progressLeft ?? []).length === 0);

  const { data: accessLeft } = await admin
    .from('course_lesson_access')
    .select('id')
    .eq('telegram_id', STU)
    .eq('sanity_lesson_id', sanityA);
  check('access по тестовому уроку удалён', (accessLeft ?? []).length === 0);

  // Повторный вызов без full block не должен ломать lives
  const before = s?.lives_current;
  await ensureCourseEnrollmentOnPurchase(admin, STU, courseId);
  s = await getEnrollmentLives(admin, STU, courseId);
  check('повторная оплата без full block не сбрасывает lives', s?.lives_current === before);
}

function cliArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function testHomeworkDeadline(): Promise<void> {
  console.log('\n== Homework deadline start ==');

  const sanitySlug = cliArg('sanity-slug')?.trim();
  let content = null;
  if (sanitySlug) {
    try {
      content = await getDistrictCourseContent(sanitySlug);
    } catch {
      content = null;
    }
  }
  if (!content) {
    skip(
      'ensureHomeworkDeadlineStarted',
      sanitySlug ? `нет Sanity content для ${sanitySlug}` : 'передайте --sanity-slug= для проверки ДЗ',
    );
    return;
  }

  const withHw = flattenCourseLessons(content).find(
    (l) => l.publicationStatus === 'published' && lessonHasHomework(l),
  );
  if (!withHw) {
    skip('ensureHomeworkDeadlineStarted', 'нет published урока с ДЗ');
    return;
  }

  await admin
    .from('course_lesson_student_progress')
    .delete()
    .eq('telegram_id', STU)
    .eq('sanity_lesson_id', withHw.sanityId);

  const started = await ensureHomeworkDeadlineStarted(admin, STU, withHw.sanityId, {
    hasAccess: true,
  });
  check('Play-path: deadline выставлен', Boolean(started?.homework_deadline_at));
  check('Play-path: lesson_first_opened_at', Boolean(started?.lesson_first_opened_at));

  const firstDeadline = started?.homework_deadline_at;
  const again = await ensureHomeworkDeadlineStarted(admin, STU, withHw.sanityId, {
    hasAccess: true,
  });
  check('повторный start идемпотентен', again?.homework_deadline_at === firstDeadline);

  const noAccess = await ensureHomeworkDeadlineStarted(admin, STU, withHw.sanityId + '-missing', {
    hasAccess: false,
  });
  check('hasAccess=false → null', noAccess === null);

  await admin
    .from('course_lesson_student_progress')
    .delete()
    .eq('telegram_id', STU)
    .eq('sanity_lesson_id', withHw.sanityId);
}

async function testDirectResetHelper(): Promise<void> {
  console.log('\n== resetCourseLearningForRepurchase (прямой вызов) ==');

  await setCourseFullyBlocked(admin, {
    telegramId: STU,
    courseId,
    adminTelegramId: ADM,
    reason: 'test before direct reset',
    blocked: true,
  });
  await admin
    .from('course_enrollment_state')
    .update({ lives_current: 0, access_blocked: true })
    .eq('telegram_id', STU)
    .eq('course_id', courseId);

  await resetCourseLearningForRepurchase(admin, STU, courseId, null);
  const s = await getEnrollmentLives(admin, STU, courseId);
  check('direct reset: lives=max', s?.lives_current === s?.lives_max);
  check('direct reset: not frozen', s?.access_blocked === false);
  check('direct reset: not fully_blocked', s?.fully_blocked === false);
}

async function main(): Promise<void> {
  console.log('test-lives-and-deadlines');
  await cleanup();

  staticSourceChecks();

  try {
    for (const [id, role, name] of [
      [STU, 'student', 'Lives Test Student'],
      [ADM, 'admin', 'Lives Test Admin'],
      [CUR, 'curator', 'Lives Test Curator'],
    ] as const) {
      const { error } = await admin.from('bot_members').insert({
        telegram_id: id,
        role,
        full_name: name,
      });
      if (error) throw error;
    }

    const course = await createCourse(admin, {
      title: 'Lives Test Course',
      slug: `lives-test-${Date.now()}`,
    });
    courseId = course.id;

    await enrollStudent(admin, STU, courseId);
    await initEnrollmentLives(admin, STU, courseId);

    const initial = await getEnrollmentLives(admin, STU, courseId);
    check('init lives=3', initial?.lives_current === 3 && initial?.lives_max === 3);

    await testFreezeUnfreeze();
    await testPromptWindow();
    await testFullyBlockedRepurchase();
    await testDirectResetHelper();
    await testHomeworkDeadline();
  } catch (error) {
    if (isLivesTableError(error)) {
      console.error('\nТаблицы жизней недоступны — примените миграции.');
    }
    console.error(error);
    failed += 1;
  } finally {
    await cleanup();
  }

  console.log(`\nИтого: ✅ ${passed}  ❌ ${failed}  ⏭ ${skipped}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
