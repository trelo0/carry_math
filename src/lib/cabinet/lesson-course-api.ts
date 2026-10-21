import { NextResponse } from 'next/server';
import {
  courseSlugFromRequestUrl,
  LessonCourseScopeError,
  requireScopedLessonCourseContext,
} from '@/lib/bot/education/course-lesson-scope';
import type { SupabaseClient } from '@supabase/supabase-js';

export function readCourseSlugFromRequest(request: Request): string | null {
  return courseSlugFromRequestUrl(request);
}

export type CabinetLessonCourseGateResult =
  | { ok: true; ctx: Awaited<ReturnType<typeof requireScopedLessonCourseContext>> }
  | { ok: false; response: NextResponse };

export async function gateCabinetLessonCourse(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  request: Request,
): Promise<CabinetLessonCourseGateResult> {
  const courseSlug = readCourseSlugFromRequest(request);
  try {
    const ctx = await requireScopedLessonCourseContext(
      admin,
      telegramId,
      sanityLessonId,
      courseSlug,
    );
    return { ok: true, ctx };
  } catch (error) {
    if (error instanceof LessonCourseScopeError) {
      const status = error.code === 'COURSE_REQUIRED' ? 400 : 403;
      return {
        ok: false,
        response: NextResponse.json({ error: error.message, code: error.code }, { status }),
      };
    }
    throw error;
  }
}
