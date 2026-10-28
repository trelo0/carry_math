import type { SupabaseClient } from '@supabase/supabase-js';
import { firstRow } from '@/lib/supabase/single-row';
import type { DistrictCourseContent } from '@/lib/studio/courseContent';
import {
  buildPublishedLessonSequence,
  determineActiveModuleForJoinCurrent,
  findFirstLessonInModule,
} from './active-module';

/** Sanity id первого занятия сценария join_current (только из enrollment). */
export async function resolveEnrollmentStartLessonSanityId(
  admin: SupabaseClient,
  courseId: number,
  content: DistrictCourseContent,
  enrollment: {
    start_lesson_id?: number | null;
    start_module_id?: number | null;
    purchase_scenario?: string | null;
  } | null,
): Promise<string | null> {
  if (!enrollment || enrollment.purchase_scenario !== 'join_current') return null;

  const startModuleId = enrollment.start_module_id as number | null | undefined;
  const startLessonId = enrollment.start_lesson_id as number | null | undefined;

  let moduleSortOrder: number | null = null;
  if (startModuleId) {
    const { data: moduleRow } = await admin
      .from('course_modules')
      .select('sort_order')
      .eq('id', startModuleId)
      .eq('course_id', courseId)
      .maybeSingle();
    moduleSortOrder =
      moduleRow?.sort_order != null ? (moduleRow.sort_order as number) : null;
  }

  const modBySort =
    moduleSortOrder != null
      ? content.modules.find((m) => m.sortOrder === moduleSortOrder)
      : undefined;

  if (startLessonId) {
    const { data: startLessonRow } = await admin
      .from('course_lessons')
      .select('sanity_lesson_id, module_id')
      .eq('id', startLessonId)
      .eq('course_id', courseId)
      .maybeSingle();

    const sanityId = startLessonRow?.sanity_lesson_id as string | null | undefined;
    if (!sanityId) return null;

    const lessonInContent = buildPublishedLessonSequence(content).find(
      (l) => l.sanityId === sanityId,
    );
    if (!lessonInContent) return null;

    if (startModuleId && startLessonRow?.module_id != null) {
      if (Number(startLessonRow.module_id) !== Number(startModuleId)) {
        return null;
      }
    }

    if (modBySort && !modBySort.lessons.some((l) => l.sanityId === sanityId)) {
      return null;
    }

    return sanityId;
  }

  if (modBySort) return findFirstLessonInModule(modBySort);

  // Оплата join_current без start_* (legacy / пустой course_modules): восстановить якорь из Sanity.
  const active = await determineActiveModuleForJoinCurrent(admin, content);
  if (active.module) return findFirstLessonInModule(active.module);

  return null;
}

export function indexOfLessonInPublishedOrder(
  orderedLessons: { sanityId: string }[],
  startSanityId: string | null,
): number | null {
  if (!startSanityId) return null;
  const idx = orderedLessons.findIndex((l) => l.sanityId === startSanityId);
  return idx >= 0 ? idx : null;
}

export type JoinCurrentGateContext = {
  gateStartIndex: number;
  archiveSanityIds: Set<string>;
  startValid: boolean;
};

export function buildJoinCurrentGateFromEnrollment(
  enrollment: { purchase_scenario?: string | null } | null,
  content: DistrictCourseContent,
  startSanityId: string | null,
): JoinCurrentGateContext | null {
  if (enrollment?.purchase_scenario !== 'join_current') return null;

  const published = buildPublishedLessonSequence(content);
  const joinStartIndex = indexOfLessonInPublishedOrder(published, startSanityId);

  if (joinStartIndex == null || !startSanityId) {
    return {
      gateStartIndex: 0,
      archiveSanityIds: new Set(),
      startValid: false,
    };
  }

  const archiveSanityIds = new Set(published.slice(0, joinStartIndex).map((l) => l.sanityId));

  return {
    gateStartIndex: joinStartIndex,
    archiveSanityIds,
    startValid: true,
  };
}

/** Фиксированный старт join_current из enrollment (не меняется при смене активного модуля потока). */
export async function loadJoinCurrentGateContext(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number | null,
  content: DistrictCourseContent,
): Promise<JoinCurrentGateContext | null> {
  if (!courseId) return null;

  const { data: enrollmentRows, error: enrErr } = await admin
    .from('course_enrollments')
    .select('purchase_scenario, start_lesson_id, start_module_id')
    .eq('telegram_id', telegramId)
    .eq('course_id', courseId)
    .order('id', { ascending: false })
    .limit(1);
  if (enrErr) throw enrErr;
  const enrollment = firstRow(enrollmentRows);

  if (enrollment?.purchase_scenario !== 'join_current') return null;

  const startSanityId = await resolveEnrollmentStartLessonSanityId(
    admin,
    courseId,
    content,
    enrollment,
  );
  return buildJoinCurrentGateFromEnrollment(enrollment, content, startSanityId);
}

export function isJoinArchiveSanityId(
  ctx: JoinCurrentGateContext | null | undefined,
  sanityLessonId: string,
): boolean {
  if (!ctx?.startValid) return false;
  return ctx.archiveSanityIds.has(sanityLessonId);
}
