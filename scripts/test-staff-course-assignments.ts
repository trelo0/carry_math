/**
 * Unit-тесты назначений на курс (без Supabase).
 * npx tsx scripts/test-staff-course-assignments.ts
 */

import { pickStaffCourseAssignment } from '../src/lib/curator/course-context';
import type { StaffCourseAssignmentOption } from '../src/lib/curator/course-context';
import {
  defaultWebSectionForCourseRole,
  filterStaffCourseRows,
  webNavSectionsForCourseRole,
} from '../src/lib/staff/course-assignment-ui';
import { buildStaffCabinetPath } from '../src/lib/staff/staff-cabinet-url';
import type { StaffCapabilities } from '../src/lib/bot/staff/capabilities';
import { resolveStaffBotMode } from '../src/lib/bot/staff/staff-menu';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const courses: StaffCourseAssignmentOption[] = [
  { courseId: 1, slug: 'a', title: 'Course A', role: 'curator' },
  { courseId: 1, slug: 'a', title: 'Course A', role: 'check' },
  { courseId: 2, slug: 'b', title: 'Course B', role: 'check' },
];

assert(pickStaffCourseAssignment(courses, { courseId: 1, courseRole: 'check' })?.role === 'check', 'pick by role check');
assert(pickStaffCourseAssignment(courses, { courseId: 1 })?.role === 'curator', 'pick curator first on same course');
assert(pickStaffCourseAssignment(courses, { courseId: 99 }) === null, 'unknown course');
assert(pickStaffCourseAssignment([courses[2]!], {})?.courseId === 2, 'single course');

assert(
  webNavSectionsForCourseRole('curator').includes('course-lessons') &&
    webNavSectionsForCourseRole('curator').includes('course-homework'),
  'curator web sections',
);
assert(
  webNavSectionsForCourseRole('check').join(',') === 'course-homework',
  'check only homework',
);
assert(defaultWebSectionForCourseRole('check') === 'course-homework', 'check default section');

const rows = [
  { courseId: 1, title: 'A', role: 'curator' as const },
  { courseId: 2, title: 'B', role: 'check' as const },
];
assert(filterStaffCourseRows(rows, 'curator-tools').length === 1, 'filter curator-tools');
assert(filterStaffCourseRows(rows, 'homework').length === 2, 'filter homework all');

const url = buildStaffCabinetPath({ section: 'course-homework', courseId: 5, courseRole: 'check' });
assert(url.includes('courseId=5') && url.includes('courseRole=check'), 'staff cabinet url');

function caps(partial: Partial<StaffCapabilities> & Pick<StaffCapabilities, 'canTeacherBot' | 'canCuratorBot' | 'canCourseStaffBot'>): StaffCapabilities {
  return {
    telegramId: 1,
    roles: ['staff'],
    primaryRole: 'staff',
    viewRole: null,
    effectiveRole: 'staff',
    ...partial,
  };
}

assert(
  resolveStaffBotMode(
    caps({
      canTeacherBot: true,
      canCuratorBot: false,
      canCourseStaffBot: true,
      effectiveRole: 'teacher',
      roles: ['teacher'],
      primaryRole: 'teacher',
    }),
  ) === 'combined',
  'teacher + course staff assignment → combined',
);

assert(
  resolveStaffBotMode(
    caps({
      canTeacherBot: false,
      canCuratorBot: false,
      canCourseStaffBot: true,
    }),
  ) === 'course_staff_only',
  'check-only staff mode',
);

console.log('test-staff-course-assignments: ok');
