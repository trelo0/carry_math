import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCuratorCourseContext } from '@/lib/curator/course-context';

export async function resolveCuratorApiCourse(
  admin: SupabaseClient,
  curatorTelegramId: number,
  courseId?: number | null,
  options?: { fullPreview?: boolean },
): Promise<{ courseId: number; courseSlug: string } | null> {
  const ctx = await resolveCuratorCourseContext(admin, curatorTelegramId, {
    courseId,
    fullPreview: options?.fullPreview,
  });
  if (!ctx) return null;
  return { courseId: ctx.courseId, courseSlug: ctx.slug };
}
