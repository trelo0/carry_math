import type { SupabaseClient } from '@supabase/supabase-js';
import type { DistrictCourseContent } from '@/lib/studio/courseContent';
import { flattenCourseLessons } from '@/lib/studio/courseContent';
import { findFirstLessonInModule } from './active-module';

/** Sanity id первого занятия сценария join_current (из enrollment, не пересчитываем поток). */
export async function resolveEnrollmentStartLessonSanityId(
  admin: SupabaseClient,
  courseId: number,
  content: DistrictCourseContent,
  enrollment: {
    start_lesson_id?: number | null;
    start_module_id?: number | null;
  } | null,
): Promise<string | null> {
  if (!enrollment) return null;

  const startLessonId = enrollment.start_lesson_id as number | null | undefined;
  if (startLessonId) {
    const { data: startLessonRow } = await admin
      .from('course_lessons')
      .select('sanity_lesson_id')
      .eq('id', startLessonId)
      .maybeSingle();
    const sanityId = startLessonRow?.sanity_lesson_id as string | null | undefined;
    if (sanityId) return sanityId;
  }

  const startModuleId = enrollment.start_module_id as number | null | undefined;
  if (!startModuleId) return null;

  const { data: moduleRow } = await admin
    .from('course_modules')
    .select('sort_order')
    .eq('id', startModuleId)
    .maybeSingle();
  const sortOrder = moduleRow?.sort_order as number | undefined;
  if (sortOrder == null) return null;

  const mod = content.modules.find((m) => m.sortOrder === sortOrder);
  if (!mod) return null;
  return findFirstLessonInModule(mod);
}

export function indexOfLessonInPublishedOrder(
  orderedLessons: { sanityId: string }[],
  startSanityId: string | null,
): number {
  if (!startSanityId) return 0;
  const idx = orderedLessons.findIndex((l) => l.sanityId === startSanityId);
  return idx >= 0 ? idx : 0;
}

export type JoinCurrentGateContext = {
  gateStartIndex: number;
  archiveSanityIds: Set<string>;
};

/** Фиксированный старт join_current из enrollment (не меняется при смене активного модуля потока). */
export async function loadJoinCurrentGateContext(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number | null,
  content: DistrictCourseContent,
): Promise<JoinCurrentGateContext | null> {
  if (!courseId) return null;

  const { data: enrollment } = await admin
    .from('course_enrollments')
    .select('purchase_scenario, start_lesson_id, start_module_id')
    .eq('telegram_id', telegramId)
    .eq('course_id', courseId)
    .maybeSingle();

  if (enrollment?.purchase_scenario !== 'join_current') return null;

  const published = flattenCourseLessons(content).filter((l) => l.publicationStatus === 'published');
  const startSanityId = await resolveEnrollmentStartLessonSanityId(admin, courseId, content, enrollment);
  const gateStartIndex = indexOfLessonInPublishedOrder(published, startSanityId);
  const effectiveGate = gateStartIndex > 0 ? gateStartIndex : 0;
  const archiveSanityIds = new Set(
    published.slice(0, effectiveGate).map((l) => l.sanityId),
  );

  return { gateStartIndex: effectiveGate, archiveSanityIds };
}

export function isJoinArchiveSanityId(
  ctx: JoinCurrentGateContext | null | undefined,
  sanityLessonId: string,
): boolean {
  return Boolean(ctx?.archiveSanityIds.has(sanityLessonId));
}
