import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCuratorCourseContext } from '@/lib/curator/course-context';

export type CuratorBotCourseScope = {
  courseId: number;
  slug: string;
};

export async function resolveCuratorBotCourseScope(
  admin: SupabaseClient,
  curatorTelegramId: number,
  options?: { courseId?: number | null; courseSlug?: string | null },
): Promise<CuratorBotCourseScope | null> {
  const ctx = await resolveCuratorCourseContext(admin, curatorTelegramId, {
    courseId: options?.courseId,
    courseSlug: options?.courseSlug,
  });
  if (!ctx) return null;
  return { courseId: ctx.courseId, slug: ctx.slug };
}

export function curatorLifeCallback(
  op: 'g' | 'd',
  studentTelegramId: number,
  courseId: number,
): string {
  return `c:life:${op}:${studentTelegramId}:${courseId}`;
}

export function parseCuratorLifeCallback(parts: string[]): {
  op: 'g' | 'd';
  studentTelegramId: number;
  courseId: number | null;
} | null {
  if (parts[1] !== 'life') return null;
  const op = parts[2];
  if (op !== 'g' && op !== 'd') return null;
  const studentTelegramId = Number(parts[3]);
  if (!Number.isFinite(studentTelegramId)) return null;
  const courseRaw = parts[4];
  const courseId =
    courseRaw != null && courseRaw !== '' ? Number(courseRaw) : Number.NaN;
  return {
    op,
    studentTelegramId,
    courseId: Number.isFinite(courseId) && courseId > 0 ? courseId : null,
  };
}
