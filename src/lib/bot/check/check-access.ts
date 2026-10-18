import type { SupabaseClient } from '@supabase/supabase-js';
import { staffHasCourseAccess } from '@/lib/bot/education/course-staff';
import { isStudentOnCourse } from '@/lib/bot/education/student-course-context';
import {
  listStaffCourseAssignmentOptions,
  type StaffCourseAssignmentOption,
} from '@/lib/curator/course-context';
import { hasFullStaffPreview, loadMemberRoles } from '@/lib/bot/roles';

export class CheckAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckAccessError';
  }
}

export async function listCheckCourses(
  admin: SupabaseClient,
  checkTelegramId: number,
): Promise<StaffCourseAssignmentOption[]> {
  const roles = await loadMemberRoles(admin, checkTelegramId);
  const fullPreview = hasFullStaffPreview(roles, checkTelegramId);
  const all = await listStaffCourseAssignmentOptions(admin, checkTelegramId, { fullPreview });
  return all.filter((c) => c.role === 'check');
}

export async function assertCheckCourseAccess(
  admin: SupabaseClient,
  checkTelegramId: number,
  courseId: number,
): Promise<StaffCourseAssignmentOption> {
  const roles = await loadMemberRoles(admin, checkTelegramId);
  if (hasFullStaffPreview(roles, checkTelegramId)) {
    const courses = await listCheckCourses(admin, checkTelegramId);
    const hit = courses.find((c) => c.courseId === courseId);
    if (hit) return hit;
    const { data } = await admin.from('courses').select('id, slug, title').eq('id', courseId).maybeSingle();
    if (!data) throw new CheckAccessError('Курс не найден.');
    return {
      courseId: data.id as number,
      slug: data.slug as string,
      title: (data.title as string) ?? 'Курс',
      role: 'check',
    };
  }
  const ok = await staffHasCourseAccess(admin, checkTelegramId, courseId, 'check');
  if (!ok) throw new CheckAccessError('Нет назначения check на этот курс.');
  const courses = await listCheckCourses(admin, checkTelegramId);
  const hit = courses.find((c) => c.courseId === courseId);
  if (!hit) throw new CheckAccessError('Курс недоступен.');
  return hit;
}

export async function assertCheckStudentOnCourse(
  admin: SupabaseClient,
  checkTelegramId: number,
  courseId: number,
  studentTelegramId: number,
): Promise<void> {
  await assertCheckCourseAccess(admin, checkTelegramId, courseId);
  const onCourse = await isStudentOnCourse(admin, studentTelegramId, courseId);
  if (!onCourse) throw new CheckAccessError('Ученик не на этом курсе.');
}
