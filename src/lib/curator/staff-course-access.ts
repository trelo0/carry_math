import type { SupabaseClient } from '@supabase/supabase-js';
import type { StaffAuthContext } from '@/lib/cabinet-auth';
import { hasFullStaffPreview, memberHasRole, type BotRole } from '@/lib/bot/roles';
import {
  staffHasCourseAccess,
  type CourseStaffRole,
} from '@/lib/bot/education/course-staff';
import { findLessonBySanityId } from '@/lib/bot/education/course-homework';
import { lookupCourseIdsBySlugs } from '@/lib/bot/education/course-record';
import { getDistrictCourseContent, listDistrictCourseSummaries } from '@/lib/studio/courseContent';
import { resolveCuratorCourseContext, type CuratorCourseOption } from '@/lib/curator/course-context';

export type CourseStaffCapability = 'curator' | 'check';

export class StaffCourseAccessError extends Error {
  constructor(
    message: string,
    readonly code: 'FORBIDDEN' | 'NOT_FOUND' = 'FORBIDDEN',
  ) {
    super(message);
    this.name = 'StaffCourseAccessError';
  }
}

/** Глобальный «может быть проверяющим» (назначение на курс проверяется отдельно). */
export function memberCanReviewHomework(roles: BotRole[], telegramId: number): boolean {
  return (
    hasFullStaffPreview(roles, telegramId) ||
    memberHasRole(roles, 'staff') ||
    memberHasRole(roles, 'check')
  );
}

/** Глобальный «может вести курс» (назначение curator на курс — отдельно). */
export function memberCanDeliverCourse(roles: BotRole[], telegramId: number): boolean {
  return (
    hasFullStaffPreview(roles, telegramId) ||
    memberHasRole(roles, 'staff') ||
    memberHasRole(roles, 'teacher') ||
    memberHasRole(roles, 'curator')
  );
}

async function resolveLessonCourseOption(
  admin: SupabaseClient,
  sanityLessonId: string,
): Promise<CuratorCourseOption | null> {
  const summaries = await listDistrictCourseSummaries().catch(() => []);
  const slugs = summaries.map((s) => s.slug);
  const idBySlug = await lookupCourseIdsBySlugs(admin, slugs);

  for (const summary of summaries) {
    const courseId = idBySlug.get(summary.slug);
    if (courseId == null) continue;
    const content = await getDistrictCourseContent(summary.slug).catch(() => null);
    if (!content) continue;
    const lesson = findLessonBySanityId(content, sanityLessonId);
    if (!lesson) continue;
    return { courseId, slug: summary.slug, title: summary.title };
  }

  const legacy = await getDistrictCourseContent().catch(() => null);
  if (legacy) {
    const lesson = findLessonBySanityId(legacy, sanityLessonId);
    if (lesson) {
      const idBySlugLegacy = await lookupCourseIdsBySlugs(admin, [legacy.slug]);
      const courseId = idBySlugLegacy.get(legacy.slug);
      if (courseId != null) {
        return { courseId, slug: legacy.slug, title: legacy.title };
      }
    }
  }
  return null;
}

export async function assertStaffCourseCapability(
  admin: SupabaseClient,
  auth: StaffAuthContext,
  courseId: number,
  capability: CourseStaffCapability,
): Promise<void> {
  const fullPreview = hasFullStaffPreview(auth.roles, auth.telegramId);
  if (fullPreview) return;

  const staffRole: CourseStaffRole = capability === 'check' ? 'check' : 'curator';
  const ok = await staffHasCourseAccess(admin, auth.telegramId, courseId, staffRole);
  if (!ok) {
    throw new StaffCourseAccessError('Нет назначения на этот курс.', 'FORBIDDEN');
  }
}

export async function assertLessonDeliveryAccess(
  admin: SupabaseClient,
  auth: StaffAuthContext,
  sanityLessonId: string,
): Promise<{ courseId: number; courseSlug: string }> {
  const courseOpt = await resolveLessonCourseOption(admin, sanityLessonId);
  if (!courseOpt) {
    throw new StaffCourseAccessError('Занятие не найдено.', 'NOT_FOUND');
  }

  await assertStaffCourseCapability(admin, auth, courseOpt.courseId, 'curator');
  return { courseId: courseOpt.courseId, courseSlug: courseOpt.slug };
}

export async function resolveCheckerApiCourse(
  admin: SupabaseClient,
  checkerTelegramId: number,
  courseId?: number | null,
  options?: { fullPreview?: boolean; roles?: BotRole[]; telegramId?: number },
): Promise<{ courseId: number; courseSlug: string } | null> {
  const roles = options?.roles ?? [];
  const telegramId = options?.telegramId ?? checkerTelegramId;
  const fullPreview = options?.fullPreview ?? hasFullStaffPreview(roles, telegramId);

  if (fullPreview) {
    const ctx = await resolveCuratorCourseContext(admin, checkerTelegramId, {
      courseId,
      fullPreview: true,
    });
    return ctx ? { courseId: ctx.courseId, courseSlug: ctx.slug } : null;
  }

  const { listCoursesForStaff } = await import('@/lib/bot/education/course-staff');
  const assigned = await listCoursesForStaff(admin, checkerTelegramId, 'check');
  if (assigned.length === 0) return null;

  const courseIds = [...new Set(assigned.map((a) => a.courseId))];
  const { data: rows, error } = await admin.from('courses').select('id, slug').in('id', courseIds);
  if (error) throw error;
  const courses = (rows ?? []).map((r) => ({ courseId: r.id as number, slug: r.slug as string }));

  const pick =
    courseId != null ? courses.find((c) => c.courseId === courseId) : courses[0] ?? null;
  if (!pick) return null;

  const ok = await staffHasCourseAccess(admin, checkerTelegramId, pick.courseId, 'check');
  if (!ok) return null;
  return { courseId: pick.courseId, courseSlug: pick.slug };
}

/** Просмотр ученика на курсе: назначение check или curator (или admin preview). */
export async function assertStaffStudentCourseView(
  admin: SupabaseClient,
  auth: StaffAuthContext,
  studentTelegramId: number,
  courseId: number,
): Promise<void> {
  const { isStudentOnCourse } = await import('@/lib/bot/education/student-course-context');
  const onCourse = await isStudentOnCourse(admin, studentTelegramId, courseId);
  if (!onCourse) {
    throw new StaffCourseAccessError('Ученик не на этом курсе.', 'NOT_FOUND');
  }
  if (hasFullStaffPreview(auth.roles, auth.telegramId)) return;

  const [asCheck, asCurator] = await Promise.all([
    staffHasCourseAccess(admin, auth.telegramId, courseId, 'check'),
    staffHasCourseAccess(admin, auth.telegramId, courseId, 'curator'),
  ]);

  if (asCheck || asCurator) return;

  throw new StaffCourseAccessError('Нет назначения на этот курс.', 'FORBIDDEN');
}
