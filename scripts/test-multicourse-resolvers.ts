/**
 * Unit checks for multicourse isolation helpers (no DB).
 * npx tsx scripts/test-multicourse-resolvers.ts
 */

import {
  hasCoursePaymentForCourse,
  resolveMapHasCourseProductAccess,
  hasViewedCourseMap,
} from '@/lib/cabinet';
import { readLessonDeliveryCourseHint } from '@/lib/curator/staff-course-access';
import {
  livesGrantCb,
  livesMenuCb,
  livesMonthlyRestoreCb,
  parseLivesOpsCourseId,
} from '@/lib/bot/admin/lives-ops-callbacks';
import { parseCuratorLifeCallback } from '@/lib/bot/curator/curator-course-scope';

const pkgA = { product: 'course' as const, total: 5, courseId: 1, title: 'A' };
const pkgB = { product: 'course' as const, total: 3, courseId: 2, title: 'B' };
const packages = [pkgA, pkgB];

if (resolveMapHasCourseProductAccess(packages, 1, 'slug-a', 'A')) {
  /* ok */
} else throw new Error('course 1 access');
if (resolveMapHasCourseProductAccess(packages, 2, 'slug-b', 'B')) {
  /* ok */
} else throw new Error('course 2 access');
if (resolveMapHasCourseProductAccess(packages, 3, 'slug-c', 'C')) {
  throw new Error('course 3 must not inherit');
}

if (!hasCoursePaymentForCourse(packages, 1, 'slug-a', 'A')) throw new Error('pay 1');
if (hasCoursePaymentForCourse(packages, 99, 'slug-a', 'A')) throw new Error('cross pay');

const slice = {
  courseMapViewed: false,
  courseMapViewedByCourseId: { 2: true },
  accesses: [],
  packages,
};
if (!hasViewedCourseMap(slice, 1, 'slug-a', 'A')) throw new Error('map 1 preview');
if (!hasViewedCourseMap(slice, 2, 'slug-b', 'B')) throw new Error('map 2 viewed');

const hintReq = new Request('https://example.test/api?course=slug-b&courseId=2');
const hint = readLessonDeliveryCourseHint(hintReq);
if (hint.courseSlug !== 'slug-b' || hint.courseId !== 2) {
  throw new Error('readLessonDeliveryCourseHint');
}

if (livesMenuCb(111, 2) !== 'al:m:111:2') throw new Error('livesMenuCb');
if (livesGrantCb(111, 2) !== 'al:g:111:2') throw new Error('livesGrantCb');
if (livesMonthlyRestoreCb(5) !== 'al:rm:5') throw new Error('livesMonthlyRestoreCb');
if (parseLivesOpsCourseId('al:g:111:2'.split(':'), 'g') !== 2) {
  throw new Error('parseLivesOpsCourseId');
}
const life = parseCuratorLifeCallback('c:life:g:999:3'.split(':'));
if (!life || life.op !== 'g' || life.studentTelegramId !== 999 || life.courseId !== 3) {
  throw new Error('parseCuratorLifeCallback');
}

console.log('test-multicourse-resolvers: ok');
