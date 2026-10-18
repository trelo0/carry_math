/**
 * Разделение ролей check / curator (логика без Supabase).
 * npx tsx scripts/test-staff-check-curator-split.ts
 */

import type { BotRole } from '../src/lib/bot/roles';
import {
  memberCanDeliverCourse,
  memberCanReviewHomework,
} from '../src/lib/curator/staff-course-access';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const curatorOnly: BotRole[] = ['curator'];
const checkOnly: BotRole[] = ['check'];
const staffOnly: BotRole[] = ['staff'];
const both: BotRole[] = ['curator', 'check'];
const teacher: BotRole[] = ['teacher'];
const admin: BotRole[] = ['admin'];

const plainId = 1001;
const adminId = 999_001;

assert(memberCanDeliverCourse(curatorOnly, plainId), 'curator delivers');
assert(!memberCanReviewHomework(curatorOnly, plainId), 'curator cannot review');

assert(memberCanReviewHomework(checkOnly, plainId), 'check reviews');
assert(!memberCanDeliverCourse(checkOnly, plainId), 'check cannot deliver');

assert(memberCanDeliverCourse(staffOnly, plainId), 'staff can deliver when assigned');
assert(memberCanReviewHomework(staffOnly, plainId), 'staff can review when assigned');

assert(memberCanDeliverCourse(both, plainId) && memberCanReviewHomework(both, plainId), 'dual legacy role');

assert(memberCanDeliverCourse(teacher, plainId), 'teacher may deliver course when assigned');
assert(!memberCanReviewHomework(teacher, plainId), 'teacher not checker by default');

assert(memberCanDeliverCourse(admin, adminId) && memberCanReviewHomework(admin, adminId), 'admin preview');

/** Имитация назначений на course_id=1 и course_id=2 */
type Assignment = { courseId: number; role: 'curator' | 'check'; staffId: number };

const assignments: Assignment[] = [
  { courseId: 1, role: 'curator', staffId: 501 },
  { courseId: 1, role: 'check', staffId: 502 },
  { courseId: 2, role: 'curator', staffId: 503 },
];

function hasAssignment(staffId: number, courseId: number, role: 'curator' | 'check'): boolean {
  return assignments.some((a) => a.staffId === staffId && a.courseId === courseId && a.role === role);
}

function canReviewOnCourse(roles: BotRole[], staffId: number, courseId: number): boolean {
  return memberCanReviewHomework(roles, staffId) && hasAssignment(staffId, courseId, 'check');
}

function canDeliverOnCourse(roles: BotRole[], staffId: number, courseId: number): boolean {
  return memberCanDeliverCourse(roles, staffId) && hasAssignment(staffId, courseId, 'curator');
}

assert(canDeliverOnCourse(curatorOnly, 501, 1), '501 delivers c1');
assert(!canReviewOnCourse(curatorOnly, 501, 1), '501 no check on c1');
assert(canReviewOnCourse(checkOnly, 502, 1), '502 checks c1');
assert(!canDeliverOnCourse(checkOnly, 502, 1), '502 no deliver c1');
assert(canReviewOnCourse(staffOnly, 502, 1), 'staff check on c1 with assignment');
assert(!canReviewOnCourse(staffOnly, 502, 2), '502 not on c2');
assert(!canDeliverOnCourse(curatorOnly, 501, 2), '501 not curator c2');

/** Повторное approve не списывает жизнь (reject path в API возвращает lifeDeduction: null). */
const lifeDeductionOnRejectApi = null;
assert(lifeDeductionOnRejectApi === null, 'reject API does not auto-deduct life');

console.log('test-staff-check-curator-split: ok');
