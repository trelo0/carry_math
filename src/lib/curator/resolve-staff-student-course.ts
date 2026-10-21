import type { SupabaseClient } from '@supabase/supabase-js';
import type { StaffAuthContext } from '@/lib/cabinet-auth';
import { hasFullStaffPreview } from '@/lib/bot/roles';
import { lookupCourseIdsBySlugs } from '@/lib/bot/education/course-record';
import { listDistrictCourseSummaries } from '@/lib/studio/courseContent';
import { listStaffCourseAssignmentOptions } from '@/lib/curator/course-context';
import { isStudentOnCourse } from '@/lib/bot/education/student-course-context';

/** Курс для staff API по ученику: query courseId / course slug или единственное пересечение enrollments. */
export async function resolveStaffStudentCourseId(
  admin: SupabaseClient,
  auth: StaffAuthContext,
  studentTelegramId: number,
  hint?: { courseId?: number | null; courseSlug?: string | null },
): Promise<number | null> {
  if (hint?.courseId != null && hint.courseId > 0) return hint.courseId;

  const slug = hint?.courseSlug?.trim();
  if (slug) {
    const idBySlug = await lookupCourseIdsBySlugs(admin, [slug]);
    const id = idBySlug.get(slug);
    if (id != null) return id;
  }

  const fullPreview = hasFullStaffPreview(auth.roles, auth.telegramId);
  let candidateIds: number[] = [];

  if (fullPreview) {
    const summaries = await listDistrictCourseSummaries().catch(() => []);
    const idBySlug = await lookupCourseIdsBySlugs(
      admin,
      summaries.map((s) => s.slug),
    );
    candidateIds = summaries
      .map((s) => idBySlug.get(s.slug))
      .filter((id): id is number => id != null);
  } else {
    const assigned = await listStaffCourseAssignmentOptions(admin, auth.telegramId);
    candidateIds = [...new Set(assigned.map((a) => a.courseId))];
  }

  const onCourse: number[] = [];
  for (const courseId of candidateIds) {
    if (await isStudentOnCourse(admin, studentTelegramId, courseId)) onCourse.push(courseId);
  }
  if (onCourse.length === 1) return onCourse[0]!;
  return null;
}
