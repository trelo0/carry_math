/**
 * npx tsx scripts/test-staff-course-workspace.ts
 */
import {
  STAFF_COURSE_MANAGEMENT_LABEL,
  STAFF_EXIT_ALL_COURSES_LABEL,
  staffCourseWorkspaceReplyKeyboard,
  staffGlobalReplyKeyboard,
  type StaffCapabilities,
} from '../src/lib/bot/staff/staff-menu';
import { workspaceFromPayload } from '../src/lib/bot/staff/staff-course-session';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const checkOnly: StaffCapabilities = {
  telegramId: 1,
  roles: ['staff'],
  primaryRole: 'staff',
  viewRole: null,
  effectiveRole: 'staff',
  canTeacherBot: false,
  canCuratorBot: false,
  canCourseStaffBot: true,
};

const globalKb = staffGlobalReplyKeyboard(checkOnly);
const globalLabels = (globalKb.keyboard ?? []).flat().map((b) => b.text);
assert(globalLabels.length === 1 && globalLabels[0] === STAFF_COURSE_MANAGEMENT_LABEL, 'check global kb');

const wsKb = staffCourseWorkspaceReplyKeyboard('check');
const wsLabels = (wsKb.keyboard ?? []).flat().map((b) => b.text);
assert(wsLabels.includes(STAFF_EXIT_ALL_COURSES_LABEL), 'workspace exit');

const ws = workspaceFromPayload({
  courseId: 3,
  staffRole: 'check',
  courseTitle: 'Test',
  courseSlug: 'test',
});
assert(ws?.courseId === 3 && ws.role === 'check', 'payload parse');

console.log('test-staff-course-workspace: ok');
