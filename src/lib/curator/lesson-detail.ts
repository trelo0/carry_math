import type { SupabaseClient } from '@supabase/supabase-js';
import type { CuratorLessonView } from '@/lib/curator/cabinet-data';
import { getCuratorCabinetData, getCuratorLessonById } from '@/lib/curator/cabinet-data';

export type CourseLessonDetailView = CuratorLessonView & {
  courseTitle: string;
};

export async function getCourseLessonDetail(
  admin: SupabaseClient,
  curatorTelegramId: number,
  curatorName: string | null,
  sanityLessonId: string,
): Promise<CourseLessonDetailView | null> {
  const data = await getCuratorCabinetData(admin, curatorTelegramId, curatorName);
  const lesson = getCuratorLessonById(data, sanityLessonId);
  if (!lesson) return null;
  return {
    ...lesson,
    courseTitle: data.courseTitle,
  };
}
