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

/** Курс для действий ученика (контакт куратора, ДЗ): явный slug или последнее активное зачисление. */
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
  }

  const { data: enrollments, error } = await admin
    .from('course_enrollments')
    .select('course_id, started_at, courses ( slug )')
    .eq('telegram_id', telegramId)
    .eq('status', ACTIVE)
    .order('started_at', { ascending: false });
  if (error) throw error;

  for (const row of enrollments ?? []) {
    const courseId = row.course_id as number;
    const slug = (row.courses as { slug?: string } | null)?.slug;
    if (courseId && slug) return { courseId, slug };
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

/** В каком активном зачислении ученика есть это занятие (Sanity id). */
export async function resolveCourseForSanityLesson(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
): Promise<{ courseId: number; slug: string; content: DistrictCourseContent } | null> {
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
    if (slug && courseId) rows.push({ courseId, slug });
  }

  const contents = await Promise.all(
    rows.map((row) => getDistrictCourseContent(row.slug).catch(() => null)),
  );

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const content = contents[i];
    if (!content) continue;
    if (findLessonBySanityId(content, sanityLessonId)) {
      return { courseId: row.courseId, slug: row.slug, content };
    }
  }

  const fallback = await getDistrictCourseContent().catch(() => null);
  if (fallback && findLessonBySanityId(fallback, sanityLessonId)) {
    const map = await lookupCourseIdsBySlugs(admin, [fallback.slug]);
    const courseId = map.get(fallback.slug);
    if (courseId != null) return { courseId, slug: fallback.slug, content: fallback };
  }

  return null;
}
