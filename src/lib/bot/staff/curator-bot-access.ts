import type { SupabaseClient } from '@supabase/supabase-js';
import { staffHasCourseAccess } from '@/lib/bot/education/course-staff';
import {
  listCuratorCourseOptions,
  resolveCuratorCourseContext,
  type CuratorCourseOption,
} from '@/lib/curator/course-context';
import { getCuratorCabinetData, type CuratorCabinetData, type CuratorLessonView } from '@/lib/curator/cabinet-data';

export const CURATOR_NO_COURSES_TEXT =
  'Нет назначений на курс как куратору.\n\nОбратитесь к администратору — в админ-боте: Обучение → Курс → Сотрудники курса.';

export async function assertCuratorCourseAccess(
  admin: SupabaseClient,
  curatorTelegramId: number,
  courseId: number,
): Promise<CuratorCourseOption | null> {
  const ctx = await resolveCuratorCourseContext(admin, curatorTelegramId, { courseId });
  if (!ctx || ctx.courseId !== courseId) return null;
  const ok = await staffHasCourseAccess(admin, curatorTelegramId, courseId, 'curator');
  return ok ? ctx : null;
}

export async function loadCuratorBotCabinet(
  admin: SupabaseClient,
  curatorTelegramId: number,
  courseId: number,
): Promise<{ ctx: CuratorCourseOption; data: CuratorCabinetData } | null> {
  const ctx = await assertCuratorCourseAccess(admin, curatorTelegramId, courseId);
  if (!ctx) return null;
  const data = await getCuratorCabinetData(admin, curatorTelegramId, null, {
    courseId: ctx.courseId,
    courseSlug: ctx.slug,
  });
  return { ctx, data };
}

export async function resolveCourseForSection(
  admin: SupabaseClient,
  curatorTelegramId: number,
  courseId: number | null,
): Promise<{ courseId: number; courses: CuratorCourseOption[] } | 'none' | 'pick'> {
  const courses = await listCuratorCourseOptions(admin, curatorTelegramId);
  if (courses.length === 0) return 'none';
  if (courseId != null) {
    const ok = courses.some((c) => c.courseId === courseId);
    if (ok) return { courseId, courses };
    return 'pick';
  }
  if (courses.length === 1) return { courseId: courses[0]!.courseId, courses };
  return 'pick';
}

export function findLessonInCabinet(
  data: CuratorCabinetData,
  lessonNumber: number,
): CuratorLessonView | null {
  return data.lessons.find((l) => l.lessonNumber === lessonNumber) ?? null;
}
