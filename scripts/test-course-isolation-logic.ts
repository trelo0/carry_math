/**
 * Изоляция курсов (логика без БД).
 * npx tsx scripts/test-course-isolation-logic.ts
 */
import assert from 'node:assert/strict';

function packageMatchesCourse(
  pkgCourseId: number | null,
  targetCourseId: number,
): boolean {
  return pkgCourseId === targetCourseId;
}

assert.equal(packageMatchesCourse(1, 1), true);
assert.equal(packageMatchesCourse(2, 1), false);
assert.equal(packageMatchesCourse(null, 1), false);

function filterLessonAccessForCourse(
  lessonIds: number[],
  accessRows: Array<{ course_lesson_id: number }>,
): number[] {
  const set = new Set(lessonIds);
  return accessRows.map((r) => r.course_lesson_id).filter((id) => set.has(id));
}

const course1Lessons = [10, 11, 12];
const mixedAccess = [
  { course_lesson_id: 10 },
  { course_lesson_id: 99 },
  { course_lesson_id: 11 },
];
assert.deepEqual(filterLessonAccessForCourse(course1Lessons, mixedAccess), [10, 11]);

console.log('test-course-isolation-logic: ok');
