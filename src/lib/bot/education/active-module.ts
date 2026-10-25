import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DistrictCourseContent,
  CourseModuleContent,
  CourseLessonContent,
} from '@/lib/studio/courseContent';
import { flattenCourseLessons } from '@/lib/studio/courseContent';
import {
  loadSanityLessonSessionMap,
  resolveWebinarSessionStatus,
  type SanityLessonSessionRow,
} from '@/lib/curator/lesson-session';

export type ActiveModuleResult = {
  module: CourseModuleContent | null;
  /** Занятие «где группа»: live или следующее незавершённое вебинар-занятие (может быть без даты). */
  nextStreamLessonSanityId: string | null;
  reason: string;
  source: 'auto_live' | 'auto_sequence' | 'auto_all_completed' | 'not_found';
};

export type StreamSchedulePointer = {
  streamScheduleSanityId: string | null;
  activeModule: CourseModuleContent | null;
  result: ActiveModuleResult;
};

function normalizeSanityDocId(id: string): string {
  return id.replace(/^drafts\./, '');
}

export function findModuleBySanityRef(
  modules: CourseModuleContent[],
  refId: string | null | undefined,
): CourseModuleContent | undefined {
  if (!refId) return undefined;
  const normalized = normalizeSanityDocId(refId);
  return modules.find(
    (m) =>
      m.sanityId === refId ||
      m.sanityId === normalized ||
      normalizeSanityDocId(m.sanityId) === normalized,
  );
}

export function findModuleContainingLesson(
  content: DistrictCourseContent,
  sanityLessonId: string,
): CourseModuleContent | undefined {
  return content.modules.find((m) => m.lessons.some((l) => l.sanityId === sanityLessonId));
}

/** Опубликованные занятия в порядке модулей и номеров в модуле. */
export function buildPublishedLessonSequence(
  content: DistrictCourseContent,
): CourseLessonContent[] {
  const modules = [...content.modules].sort((a, b) => a.sortOrder - b.sortOrder);
  const out: CourseLessonContent[] = [];
  for (const mod of modules) {
    const lessons = [...mod.lessons]
      .filter((l) => l.publicationStatus === 'published')
      .sort((a, b) => a.lessonNumber - b.lessonNumber || a.sortOrder - b.sortOrder);
    out.push(...lessons);
  }
  return out;
}

function sessionStatusForLesson(
  lesson: CourseLessonContent,
  sessionMap: Map<string, SanityLessonSessionRow>,
): ReturnType<typeof resolveWebinarSessionStatus> {
  if (lesson.lessonType !== 'webinar') return 'scheduled';
  return resolveWebinarSessionStatus(
    lesson.scheduledAt,
    sessionMap.get(lesson.sanityId),
    lesson.recordingUrl,
  );
}

/**
 * Индекс «курсора» потока: первое незавершённое опубликованное вебинар-занятие в порядке курса.
 * Отменённые вебинары пропускаются. Не перескакивает через более ранние незавершённые вебинары.
 */
export function findStreamCursorIndex(
  sequence: CourseLessonContent[],
  sessionMap: Map<string, SanityLessonSessionRow>,
): number {
  for (let i = 0; i < sequence.length; i += 1) {
    const lesson = sequence[i]!;
    if (lesson.lessonType !== 'webinar') continue;
    const status = sessionStatusForLesson(lesson, sessionMap);
    if (status === 'cancelled') continue;
    if (status !== 'completed') return i;
  }
  return sequence.length;
}

/** Первый live-вебинар в порядке курса (при нескольких live — детерминированно первый). */
export function findFirstLiveWebinarInSequence(
  sequence: CourseLessonContent[],
  sessionMap: Map<string, SanityLessonSessionRow>,
): CourseLessonContent | null {
  for (const lesson of sequence) {
    if (lesson.lessonType !== 'webinar') continue;
    if (sessionStatusForLesson(lesson, sessionMap) === 'live') return lesson;
  }
  return null;
}

/**
 * Активный модуль потока без БД (для тестов и чистой логики).
 */
/** Позиция группы в потоке: live → иначе первое незавершённое вебинар-занятие по курсу. */
export function resolveStreamSchedulePointer(
  content: DistrictCourseContent,
  sessionMap: Map<string, SanityLessonSessionRow>,
): StreamSchedulePointer {
  const result = resolveActiveModuleFromSessions(content, sessionMap);
  const sequence = buildPublishedLessonSequence(content);
  const liveLesson = findFirstLiveWebinarInSequence(sequence, sessionMap);
  const streamScheduleSanityId =
    liveLesson?.sanityId ?? result.nextStreamLessonSanityId ?? null;
  return {
    streamScheduleSanityId,
    activeModule: result.module,
    result,
  };
}

export function resolveActiveModuleFromSessions(
  content: DistrictCourseContent,
  sessionMap: Map<string, SanityLessonSessionRow>,
): ActiveModuleResult {
  const sequence = buildPublishedLessonSequence(content);
  if (sequence.length === 0) {
    return {
      module: null,
      nextStreamLessonSanityId: null,
      reason: 'Нет опубликованных занятий',
      source: 'not_found',
    };
  }

  const liveLesson = findFirstLiveWebinarInSequence(sequence, sessionMap);
  if (liveLesson) {
    const mod = findModuleContainingLesson(content, liveLesson.sanityId);
    if (mod) {
      return {
        module: mod,
        nextStreamLessonSanityId: liveLesson.sanityId,
        reason: 'Текущий live-вебинар',
        source: 'auto_live',
      };
    }
  }

  const cursor = findStreamCursorIndex(sequence, sessionMap);
  if (cursor >= sequence.length) {
    const last = sequence[sequence.length - 1]!;
    const mod = findModuleContainingLesson(content, last.sanityId);
    return {
      module: mod ?? null,
      nextStreamLessonSanityId: null,
      reason: 'Все вебинары потока завершены',
      source: 'auto_all_completed',
    };
  }

  const nextLesson = sequence[cursor]!;
  const activeModule = findModuleContainingLesson(content, nextLesson.sanityId);
  if (!activeModule) {
    return {
      module: null,
      nextStreamLessonSanityId: nextLesson.sanityId,
      reason: 'Не найден модуль для следующего занятия потока',
      source: 'not_found',
    };
  }

  return {
    module: activeModule,
    nextStreamLessonSanityId: nextLesson.sanityId,
    reason:
      nextLesson.lessonType === 'webinar'
        ? 'Следующий вебинар в последовательности курса'
        : 'Следующее занятие в модуле до следующего вебинара',
    source: 'auto_sequence',
  };
}

/**
 * Активный модуль потока: live → первый незавершённый вебинар по порядку курса.
 * join_current: старт с первого занятия этого модуля; более ранние — архив.
 */
export async function loadWebinarSessionMapForContent(
  admin: SupabaseClient,
  content: DistrictCourseContent,
): Promise<Map<string, SanityLessonSessionRow>> {
  const sequence = buildPublishedLessonSequence(content);
  const webinarIds = sequence
    .filter((l) => l.lessonType === 'webinar')
    .map((l) => l.sanityId);
  if (webinarIds.length === 0) return new Map();
  return loadSanityLessonSessionMap(admin, webinarIds);
}

/** Активный модуль для сценария join_current (ручной override → иначе поток по вебинарам). */
export function resolveActiveModuleForJoinCurrent(
  content: DistrictCourseContent,
  sessionMap: Map<string, SanityLessonSessionRow>,
): ActiveModuleResult {
  const overrideMod = findModuleBySanityRef(content.modules, content.activeModuleOverride);
  if (overrideMod) {
    const firstInModule = findFirstLessonInModule(overrideMod);
    return {
      module: overrideMod,
      nextStreamLessonSanityId: firstInModule,
      reason: 'Ручной выбор активного модуля (Sanity)',
      source: 'auto_sequence',
    };
  }
  return resolveActiveModuleFromSessions(content, sessionMap);
}

export async function determineActiveModuleForJoinCurrent(
  admin: SupabaseClient,
  content: DistrictCourseContent,
): Promise<ActiveModuleResult> {
  const sessionMap = await loadWebinarSessionMapForContent(admin, content);
  return resolveActiveModuleForJoinCurrent(content, sessionMap);
}

export async function determineActiveModule(
  admin: SupabaseClient,
  content: DistrictCourseContent,
): Promise<ActiveModuleResult> {
  const sessionMap = await loadWebinarSessionMapForContent(admin, content);
  return resolveActiveModuleFromSessions(content, sessionMap);
}

export type JoinCurrentStartIds = {
  startModuleId: number | null;
  startLessonId: number | null;
  startLessonSanityId: string | null;
};

/** Стартовые id для join_current: занятие из Sanity, module_id в Supabase опционален. */
export async function resolveJoinCurrentStartIds(
  admin: SupabaseClient,
  courseId: number,
  content: DistrictCourseContent,
): Promise<JoinCurrentStartIds> {
  const activeModuleResult = await determineActiveModuleForJoinCurrent(admin, content);
  if (!activeModuleResult.module) {
    return { startModuleId: null, startLessonId: null, startLessonSanityId: null };
  }

  const firstLessonSanityId = findFirstLessonInModule(activeModuleResult.module);
  if (!firstLessonSanityId) {
    return { startModuleId: null, startLessonId: null, startLessonSanityId: null };
  }

  let startModuleId: number | null = null;
  const { data: moduleRow } = await admin
    .from('course_modules')
    .select('id')
    .eq('course_id', courseId)
    .eq('sort_order', activeModuleResult.module.sortOrder)
    .maybeSingle();
  if (moduleRow?.id) startModuleId = moduleRow.id as number;

  let startLessonId: number | null = null;
  const { data: lessonRow } = await admin
    .from('course_lessons')
    .select('id')
    .eq('course_id', courseId)
    .eq('sanity_lesson_id', firstLessonSanityId)
    .maybeSingle();
  if (lessonRow?.id) startLessonId = lessonRow.id as number;

  return { startModuleId, startLessonId, startLessonSanityId: firstLessonSanityId };
}

/**
 * Первое опубликованное занятие модуля по порядку.
 */
export function findFirstLessonInModule(module: CourseModuleContent): string | null {
  if (!module.lessons?.length) return null;
  const sortedLessons = [...module.lessons]
    .filter((l) => l.publicationStatus === 'published')
    .sort((a, b) => a.lessonNumber - b.lessonNumber || a.sortOrder - b.sortOrder);
  return sortedLessons[0]?.sanityId ?? null;
}

/**
 * Находит первое занятие после пробного в курсе.
 */
export function findFirstPaidLesson(content: DistrictCourseContent): string | null {
  const allLessons = buildPublishedLessonSequence(content);
  const firstPaid = allLessons.find((l) => !l.isTrialFree);
  return firstPaid?.sanityId ?? null;
}
