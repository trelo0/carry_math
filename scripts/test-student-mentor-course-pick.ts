/**
 * Логика выбора курса для student:mentor (без Supabase).
 * npx tsx scripts/test-student-mentor-course-pick.ts
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

type Enrollment = { courseId: number; title: string };

function shouldShowCoursePicker(
  needsCourse: boolean,
  explicitCourseId: number | null,
  courseSlug: string | null,
  enrollments: Enrollment[],
): boolean {
  if (!needsCourse) return false;
  if (explicitCourseId != null) return false;
  if (courseSlug) return false;
  return enrollments.length > 1;
}

assert(
  shouldShowCoursePicker(true, null, null, [
    { courseId: 1, title: 'A' },
    { courseId: 2, title: 'B' },
  ]),
  'multi course → picker',
);
assert(!shouldShowCoursePicker(true, null, null, [{ courseId: 1, title: 'A' }]), 'single → no picker');
assert(!shouldShowCoursePicker(true, 5, null, [{ courseId: 1, title: 'A' }]), 'explicit id');
assert(!shouldShowCoursePicker(false, null, null, [{ courseId: 1, title: 'A' }]), 'lessons context');

assert('m:cr:42'.startsWith('m:cr:'), 'callback prefix');

console.log('test-student-mentor-course-pick: ok');
