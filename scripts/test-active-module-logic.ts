/**
 * Логика потока без Supabase. Запуск: npx tsx scripts/test-active-module-logic.ts
 */
import assert from 'node:assert/strict';
import type {
  CourseLessonContent,
  CourseModuleContent,
  DistrictCourseContent,
} from '../src/lib/studio/courseContent';
import {
  buildPublishedLessonSequence,
  findStreamCursorIndex,
  resolveActiveModuleFromSessions,
  resolveStreamSchedulePointer,
  findFirstLessonInModule,
} from '../src/lib/bot/education/active-module';
import type { SanityLessonSessionRow } from '../src/lib/curator/lesson-session';

function lesson(
  partial: Partial<CourseLessonContent> & { sanityId: string; lessonNumber: number },
): CourseLessonContent {
  return {
    sanityId: partial.sanityId,
    title: partial.title ?? partial.sanityId,
    description: null,
    lessonType: partial.lessonType ?? 'webinar',
    lessonNumber: partial.lessonNumber,
    sortOrder: partial.sortOrder ?? partial.lessonNumber,
    publicationStatus: partial.publicationStatus ?? 'published',
    isTrialFree: partial.isTrialFree ?? false,
    scheduledAt: partial.scheduledAt ?? null,
    liveUrl: null,
    recordingUrl: null,
    mandatoryHomework: true,
    homework: null,
    materials: [],
    homeworkFiles: [],
    contentChips: [],
  };
}

function mod(
  sortOrder: number,
  lessons: CourseLessonContent[],
  sanityId?: string,
): CourseModuleContent {
  return {
    sanityId: sanityId ?? `mod-${sortOrder}`,
    title: `Module ${sortOrder}`,
    description: null,
    color: '#000',
    sortOrder,
    lessons,
  };
}

function content(modules: CourseModuleContent[]): DistrictCourseContent {
  return {
    sanityId: 'course-1',
    title: 'Test',
    slug: 'test',
    description: null,
    cabinetEyebrow: null,
    deliveryFormat: null,
    homeworkIntro: null,
    coverImageUrl: null,
    previewImageUrl: null,
    previewInsideItems: [],
    previewAfterEnrollment: null,
    previewAudience: null,
    publicationStatus: 'published',
    curatorName: null,
    curatorTelegramId: null,
    priceByn: 0,
    grantedLessons: 0,
    pricingCardText: null,
    purchaseScenarios: null,
    activeModuleOverride: null,
    modules,
  };
}

function session(status: SanityLessonSessionRow['status']): SanityLessonSessionRow {
  return {
    sanity_lesson_id: '',
    status,
    started_at: null,
    ended_at: null,
    started_by: null,
    ended_by: null,
    updated_at: new Date().toISOString(),
  };
}

const m1w1 = lesson({ sanityId: 'w1', lessonNumber: 1 });
const m1w2 = lesson({ sanityId: 'w2', lessonNumber: 2 });
const m2w1 = lesson({ sanityId: 'w3', lessonNumber: 3 });
const m2w2 = lesson({ sanityId: 'w4', lessonNumber: 4, scheduledAt: null });

const twoModuleCourse = content([
  mod(0, [m1w1, m1w2], 'mod-m1'),
  mod(1, [m2w1, m2w2], 'mod-m2'),
]);

const seq = buildPublishedLessonSequence(twoModuleCourse);
assert.equal(seq.length, 4);
assert.equal(seq[0]?.sanityId, 'w1');

// M1 w1 completed, w2 not → cursor at w2, module M1
{
  const map = new Map<string, SanityLessonSessionRow>([
    ['w1', { ...session('completed'), sanity_lesson_id: 'w1' }],
  ]);
  assert.equal(findStreamCursorIndex(seq, map), 1);
  const r = resolveActiveModuleFromSessions(twoModuleCourse, map);
  assert.equal(r.module?.sanityId, 'mod-m1');
  assert.equal(r.nextStreamLessonSanityId, 'w2');
}

// M1 all webinars completed → cursor at M2 w3 (no date ok)
{
  const map = new Map<string, SanityLessonSessionRow>([
    ['w1', { ...session('completed'), sanity_lesson_id: 'w1' }],
    ['w2', { ...session('completed'), sanity_lesson_id: 'w2' }],
  ]);
  assert.equal(findStreamCursorIndex(seq, map), 2);
  const r = resolveActiveModuleFromSessions(twoModuleCourse, map);
  assert.equal(r.module?.sanityId, 'mod-m2');
  assert.equal(r.nextStreamLessonSanityId, 'w3');
}

// Live on w3 → M2 even if w2 incomplete (live wins)
{
  const map = new Map<string, SanityLessonSessionRow>([
    ['w3', { ...session('live'), sanity_lesson_id: 'w3' }],
  ]);
  const r = resolveActiveModuleFromSessions(twoModuleCourse, map);
  assert.equal(r.source, 'auto_live');
  assert.equal(r.module?.sanityId, 'mod-m2');
}

// M1 done, cursor w3 (first M2) — join_current старт с w3, не с w4
{
  const map = new Map<string, SanityLessonSessionRow>([
    ['w1', { ...session('completed'), sanity_lesson_id: 'w1' }],
    ['w2', { ...session('completed'), sanity_lesson_id: 'w2' }],
  ]);
  const ptr = resolveStreamSchedulePointer(twoModuleCourse, map);
  assert.equal(ptr.streamScheduleSanityId, 'w3');
  assert.equal(ptr.activeModule?.sanityId, 'mod-m2');
  const m2 = twoModuleCourse.modules.find((m) => m.sanityId === 'mod-m2')!;
  assert.equal(findFirstLessonInModule(m2), 'w3');
}

// activeModuleOverride не влияет на поток (только Sanity-поле для других сценариев)
{
  const withOverride = { ...twoModuleCourse, activeModuleOverride: 'mod-m2' };
  const r = resolveActiveModuleFromSessions(withOverride, new Map());
  assert.equal(r.module?.sanityId, 'mod-m1');
  assert.equal(r.nextStreamLessonSanityId, 'w1');
}

console.log('test-active-module-logic: ok');
