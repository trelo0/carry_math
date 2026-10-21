import type { SupabaseClient } from '@supabase/supabase-js';
import { lookupCourseIdsBySlugs } from '@/lib/bot/education/course-record';
import { getDistrictCourseContent, type DistrictCourseContent } from '@/lib/studio/courseContent';
import { findLessonBySanityId } from '@/lib/bot/education/course-homework';

const ACTIVE = 'active';

export type StudentCourseContext = {
  courseId: number;
  slug: string;
};

export type StudentCourseEnrollmentOption = {
  courseId: number;
  slug: string;
  title: string;
};

/** Все активные зачисления ученика (для выбора курса в боте). */
export async function listStudentActiveCourseContexts(
  admin: SupabaseClient,
  telegramId: number,
): Promise<StudentCourseEnrollmentOption[]> {
  const { data, error } = await admin
    .from('course_enrollments')
    .select('course_id, courses ( slug, title )')
    .eq('telegram_id', telegramId)
    .eq('status', ACTIVE)
    .order('started_at', { ascending: false });
  if (error) throw error;

  const out: StudentCourseEnrollmentOption[] = [];
  const seen = new Set<number>();
  for (const row of data ?? []) {
    const courseId = row.course_id as number;
    if (seen.has(courseId)) continue;
    seen.add(courseId);
    const course = row.courses as { slug?: string; title?: string } | null;
    const slug = course?.slug?.trim();
    if (!slug) continue;
    out.push({
      courseId,
      slug,
      title: (course?.title as string | undefined)?.trim() || slug,
    });
  }
  return out;
}

/** Купленные курсы для бота: есть пакет/зачисление, курс не «закрыт для всех». */
export async function listStudentPurchasedVisibleCourseContexts(
  admin: SupabaseClient,
  telegramId: number,
): Promise<StudentCourseEnrollmentOption[]> {
  const { studentHasCourseAccessForCourse } = await import('./course-access');
  const { isDistrictCourseFullyClosed } = await import('@/lib/studio/courseContent');
  const enrollments = await listStudentActiveCourseContexts(admin, telegramId);
  const out: StudentCourseEnrollmentOption[] = [];
  for (const ctx of enrollments) {
    const hasAccess = await studentHasCourseAccessForCourse(admin, telegramId, ctx.courseId);
    if (!hasAccess) continue;
    const content = await getDistrictCourseContent(ctx.slug).catch(() => null);
    if (content && isDistrictCourseFullyClosed(content.courseClosed)) continue;
    out.push({
      ...ctx,
      title: content?.title?.trim() || ctx.title,
    });
  }
  return out;
}

/** Курс для действий ученика: явный slug или единственное активное зачисление (без «последнего» при нескольких). */
export async function resolveStudentCourseContext(
  admin: SupabaseClient,
  telegramId: number,
  preferredSlug?: string | null,
): Promise<StudentCourseContext | null> {
  if (preferredSlug) {
    const content = await getDistrictCourseContent(preferredSlug).catch(() => null);
    const slug = content?.slug ?? preferredSlug;
    const map = await lookupCourseIdsBySlugs(admin, [slug]);
    const courseId = map.get(slug);
    if (courseId != null) {
      const enrolled = await isStudentOnCourse(admin, telegramId, courseId);
      if (enrolled) return { courseId, slug };
    }
    return null;
  }

  const enrollments = await listStudentActiveCourseContexts(admin, telegramId);
  if (enrollments.length === 1) {
    const only = enrollments[0]!;
    return { courseId: only.courseId, slug: only.slug };
  }
  return null;
}

export async function isStudentOnCourse(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
): Promise<boolean> {
  const { data: enrollment } = await admin
    .from('course_enrollments')
    .select('id')
    .eq('telegram_id', telegramId)
    .eq('course_id', courseId)
    .eq('status', ACTIVE)
    .maybeSingle();
  return Boolean(enrollment);
}

/** В каком активном зачислении ученика есть это занятие (Sanity id). Без fallback на «дефолтный» курс. */
export async function resolveCourseForSanityLesson(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  preferredSlug?: string | null,
): Promise<{ courseId: number; slug: string; content: DistrictCourseContent } | null> {
  const slugFilter = preferredSlug?.trim() || null;

  const { data: enrollments, error } = await admin
    .from('course_enrollments')
    .select('course_id, courses ( slug )')
    .eq('telegram_id', telegramId)
    .eq('status', ACTIVE)
    .order('started_at', { ascending: false });
  if (error) throw error;

  const rows: { courseId: number; slug: string }[] = [];
  for (const row of enrollments ?? []) {
    const coursesRaw = row.courses;
    const joined = Array.isArray(coursesRaw) ? coursesRaw[0] : coursesRaw;
    const slug = (joined as { slug?: string } | null)?.slug?.trim();
    const courseId = row.course_id as number;
    if (!slug || !courseId) continue;
    if (slugFilter && slug !== slugFilter) continue;
    rows.push({ courseId, slug });
  }

  const contents = await Promise.all(
    rows.map((row) => getDistrictCourseContent(row.slug).catch(() => null)),
  );

  const matches: { courseId: number; slug: string; content: DistrictCourseContent }[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const content = contents[i];
    if (!content) continue;
    if (findLessonBySanityId(content, sanityLessonId)) {
      matches.push({ courseId: row.courseId, slug: row.slug, content });
    }
  }

  if (matches.length === 1) return matches[0]!;
  return null;
}
