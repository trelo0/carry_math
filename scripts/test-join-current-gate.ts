/**
 * join_current: архив и gateStartIndex по опубликованному порядку.
 * npx tsx scripts/test-join-current-gate.ts
 */
import assert from 'node:assert/strict';
import type { CourseLessonContent, CourseModuleContent, DistrictCourseContent } from '../src/lib/studio/courseContent';
import { buildPublishedLessonSequence } from '../src/lib/bot/education/active-module';
import { indexOfLessonInPublishedOrder } from '../src/lib/bot/education/course-enrollment-start';

function lesson(
  partial: Partial<CourseLessonContent> & { sanityId: string; lessonNumber: number },
): CourseLessonContent {
  return {
    sanityId: partial.sanityId,
    title: partial.sanityId,
    description: null,
    lessonType: partial.lessonType ?? 'webinar',
    lessonNumber: partial.lessonNumber,
    sortOrder: partial.sortOrder ?? partial.lessonNumber,
    publicationStatus: partial.publicationStatus ?? 'published',
    isTrialFree: partial.isTrialFree ?? false,
    scheduledAt: null,
    liveUrl: null,
    recordingUrl: null,
    mandatoryHomework: true,
    homework: null,
    materials: [],
    homeworkFiles: [],
    contentChips: [],
  };
}

function mod(sortOrder: number, lessons: CourseLessonContent[]): CourseModuleContent {
  return {
    sanityId: `mod-${sortOrder}`,
    title: `M${sortOrder}`,
    description: null,
    color: '#000',
    sortOrder,
    lessons,
  };
}

const content: DistrictCourseContent = {
  sanityId: 'c1',
  title: 'T',
  slug: 't',
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
  grantedLessons: 4,
  pricingCardText: null,
  purchaseScenarios: null,
  activeModuleOverride: null,
  modules: [
    mod(1, [
      lesson({ sanityId: 'a', lessonNumber: 2, sortOrder: 2 }),
      lesson({ sanityId: 'b', lessonNumber: 1, sortOrder: 1 }),
    ]),
    mod(0, [lesson({ sanityId: 'start', lessonNumber: 1, sortOrder: 1 })]),
  ],
};

const published = buildPublishedLessonSequence(content);
assert.deepEqual(
  published.map((l) => l.sanityId),
  ['start', 'b', 'a'],
  'published order: modules by sortOrder, lessons by lessonNumber',
);

const startSanityId = 'a';
const startIdx = indexOfLessonInPublishedOrder(published, startSanityId);
assert.equal(startIdx, 2);

const archive = new Set(published.slice(0, startIdx!).map((l) => l.sanityId));
assert.deepEqual([...archive], ['start', 'b']);

const visibleOrder = [published[1]!, published[2]!];
const gateOnVisible = indexOfLessonInPublishedOrder(visibleOrder, 'start');
assert.equal(gateOnVisible, null, 'стартовое занятие не на карте — gate только по видимым индексам');

console.log('test-join-current-gate: ok');
