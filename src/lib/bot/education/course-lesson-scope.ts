import type { SupabaseClient } from '@supabase/supabase-js';
import { findLessonBySanityId } from '@/lib/bot/education/course-homework';
import {
  isStudentOnCourse,
  resolveCourseForSanityLesson,
} from '@/lib/bot/education/student-course-context';
import { getDistrictCourseContent, type DistrictCourseContent } from '@/lib/studio/courseContent';
import { lookupCourseIdsBySlugs, resolveCourseIdForContent } from '@/lib/bot/education/course-record';

export type LessonCourseContext = {
  courseId: number;
  slug: string;
  content: DistrictCourseContent;
};

export class LessonCourseScopeError extends Error {
  constructor(
    message: string,
    readonly code: 'COURSE_REQUIRED' | 'NOT_FOUND' | 'NOT_ENROLLED' | 'LESSON_NOT_IN_COURSE',
  ) {
    super(message);
    this.name = 'LessonCourseScopeError';
  }
}

export async function countActiveCourseEnrollments(
  admin: SupabaseClient,
  telegramId: number,
): Promise<number> {
  const { count, error } = await admin
    .from('course_enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', telegramId)
    .eq('status', 'active');
  if (error) throw error;
  return count ?? 0;
}

/** Контекст курса для урока: явный slug или однозначное зачисление. */
export async function resolveScopedLessonCourseContext(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  preferredCourseSlug?: string | null,
): Promise<LessonCourseContext | null> {
  const slug = preferredCourseSlug?.trim() || null;
  if (slug) {
    const content = await getDistrictCourseContent(slug).catch(() => null);
    if (!content || !findLessonBySanityId(content, sanityLessonId)) return null;
    const courseId = await resolveCourseIdForContent(admin, content);
    if (courseId == null) return null;
    const enrolled = await isStudentOnCourse(admin, telegramId, courseId);
    if (!enrolled) return null;
    return { courseId, slug: content.slug, content };
  }

  return resolveCourseForSanityLesson(admin, telegramId, sanityLessonId);
}

/** То же, но 400 если несколько курсов без slug. */
export async function requireScopedLessonCourseContext(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  preferredCourseSlug?: string | null,
): Promise<LessonCourseContext> {
  const slug = preferredCourseSlug?.trim() || null;
  if (!slug) {
    const enrollmentCount = await countActiveCourseEnrollments(admin, telegramId);
    if (enrollmentCount > 1) {
      throw new LessonCourseScopeError(
        'Укажите курс (параметр course в URL).',
        'COURSE_REQUIRED',
      );
    }
  }

  const ctx = await resolveScopedLessonCourseContext(
    admin,
    telegramId,
    sanityLessonId,
    slug,
  );
  if (!ctx) {
    throw new LessonCourseScopeError('Занятие или курс не найдены.', 'NOT_FOUND');
  }
  if (!findLessonBySanityId(ctx.content, sanityLessonId)) {
    throw new LessonCourseScopeError('Занятие не относится к этому курсу.', 'LESSON_NOT_IN_COURSE');
  }
  return ctx;
}

/** course_id для строки прогресса (явный или из зачисления). */
export async function resolveProgressCourseId(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  preferredCourseId?: number | null,
  preferredCourseSlug?: string | null,
): Promise<number | null> {
  if (preferredCourseId != null) return preferredCourseId;
  const resolved = await resolveCourseForSanityLesson(
    admin,
    telegramId,
    sanityLessonId,
    preferredCourseSlug,
  );
  return resolved?.courseId ?? null;
}

export function courseSlugFromRequestUrl(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const course = url.searchParams.get('course')?.trim();
    return course || null;
  } catch {
    return null;
  }
}
