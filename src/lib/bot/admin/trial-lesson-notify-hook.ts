import type { SupabaseClient } from '@supabase/supabase-js';
import { flattenCourseLessons } from '@/lib/studio/courseContent';
import type { DistrictCourseContent } from '@/lib/studio/courseContent';
import { recordTrialLessonFirstView } from './user-activity-events';

export async function maybeNotifyTrialLessonWatch(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  content: DistrictCourseContent,
  courseId: number | null,
): Promise<void> {
  const lesson = flattenCourseLessons(content).find((l) => l.sanityId === sanityLessonId);
  if (!lesson?.isTrialFree) return;
  const courseTitle = content.title?.trim() || 'Курс';
  const lessonTitle = lesson.title?.trim() || null;
  await recordTrialLessonFirstView(
    admin,
    telegramId,
    courseId,
    sanityLessonId,
    courseTitle,
    lessonTitle,
  );
}
