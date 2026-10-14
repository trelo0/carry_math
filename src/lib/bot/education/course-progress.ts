import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CourseLessonContent,
  DistrictCourseContent,
} from '@/lib/studio/courseContent';
import {
  defaultWebinarSessionStatus,
  loadSanityLessonSessionMap,
  resolveWebinarSessionStatus,
  type SanityWebinarSessionStatus,
} from '@/lib/curator/lesson-session';
import {
  DEFAULT_LESSON_CONTENT_CHIPS,
  flattenCourseLessons,
  isLessonVisible,
  mapLessonKind,
} from '@/lib/studio/courseContent';
import {
  isCourseLessonCleared,
  previousCourseLessonsCleared,
  sumCoursePackageLessonEntitlement,
} from '@/lib/bot/education/course-access';
import {
  computeLessonProgressPercent,
  isLessonProgressCompleted,
  homeworkRequiredForLesson,
  lessonHasHomework,
} from '@/lib/bot/education/lesson-progress-calc';

function normalizeMaterialsOpened(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

function normalizeProgressRow(row: CourseLessonStudentProgress): CourseLessonStudentProgress {
  return {
    ...row,
    watch_percent: typeof row.watch_percent === 'number' ? row.watch_percent : 0,
    materials_opened: normalizeMaterialsOpened(row.materials_opened),
  };
}

type CourseCabinetState = 'preview' | 'enrolled_locked' | 'full';

export type CourseMapStopStatus = 'locked' | 'now' | 'watched' | 'done';

/** Причина недоступности точки на карте (для подписей и стилей). */
export type CourseMapAccessState =
  | 'available'
  | 'completed'
  | 'locked_unpaid'
  | 'locked_unpaid_past'
  | 'locked_prerequisite'
  | 'locked_prerequisite_past';

export type HomeworkProgressStatus = 'pending' | 'submitted' | 'approved' | 'rejected';

export type CourseLessonStudentProgress = {
  id: number;
  telegram_id: number;
  course_lesson_id: number | null;
  sanity_lesson_id: string | null;
  live_attended_at: string | null;
  recording_watched_at: string | null;
  /** 0–100, макс. % просмотра видео */
  watch_percent: number;
  /** Ключи открытых файлов материалов */
  materials_opened: string[];
  homework_status: HomeworkProgressStatus;
  homework_submitted_at: string | null;
  homework_completed_at: string | null;
  submission_note: string | null;
  submission_file_url: string | null;
  review_note: string | null;
  completed_at: string | null;
  updated_at: string;
  /** Первое открытие занятия (старт таймера ДЗ). */
  lesson_first_opened_at?: string | null;
  homework_deadline_at?: string | null;
  homework_remaining_ms?: number | null;
  homework_overdue_at?: string | null;
  hw_remind_12h_at?: string | null;
  hw_remind_6h_at?: string | null;
  hw_remind_2h_at?: string | null;
  hw_overdue_student_at?: string | null;
  hw_overdue_curator_at?: string | null;
};

export type CourseLessonCatalogRow = {
  id: number;
  course_id: number;
  module_id: number;
  lesson_index: number;
  num_in_module: number;
  title: string;
  kind: 'webinar' | 'practice' | 'milestone';
  is_trial_free: boolean;
};

export type CourseModuleRow = {
  id: number;
  course_id: number;
  title: string;
  color: string;
  about: string | null;
  sort_order: number;
  lesson_count: number;
};

export type CourseLessonSessionRow = {
  course_lesson_id: number;
  starts_at: string | null;
  live_url: string | null;
  recording_url: string | null;
  status: 'scheduled' | 'waiting' | 'live' | 'completed' | 'cancelled';
};

export type WebinarSessionStatus = SanityWebinarSessionStatus;

export type CourseMapStop = {
  sanityLessonId: string | null;
  lessonId: number | null;
  lessonIndex: number;
  moduleIndex: number;
  numInModule: number;
  isCurrent: boolean;
  title: string;
  description: string | null;
  kind: 'webinar' | 'practice' | 'milestone';
  status: CourseMapStopStatus;
  sessionStartsAt: string | null;
  liveUrl: string | null;
  recordingUrl: string | null;
  sessionStatus: WebinarSessionStatus | null;
  mandatoryHomework: boolean;
  homeworkStatus: HomeworkProgressStatus | null;
  homeworkTitle: string | null;
  homeworkReviewNote: string | null;
  homeworkCompletedAt: string | null;
  homeworkDeadlineAt: string | null;
  homeworkRemainingMs: number | null;
  homeworkOverdueAt: string | null;
  /** 0–100 вычисляемый прогресс урока (материал 60% + ДЗ 40%) */
  lessonProgressPercent: number;
  isTrialFree: boolean;
  contentChips: string[];
  materials: { title: string; fileName: string | null; fileSize: string | null; url: string | null }[];
  homeworkFiles: { title: string; fileName: string | null; fileSize: string | null; url: string | null }[];
  mapAccessState: CourseMapAccessState;
  /** Занятие идёт по расписанию (эфир / ожидание эфира), независимо от доступа ученика. */
  isScheduleActive: boolean;
  /** Первое в цепочке, где не пройдены предыдущие (для подписи «Доступно»). */
  isFirstChainGate: boolean;
  /** join_current: занятия до стартового модуля (без ДЗ и без кредитов). */
  isJoinArchive: boolean;
  /** Модуль, который сейчас идёт в потоке (Sanity override или авто по вебинарам). */
  isStreamActiveModule: boolean;
};

export function isCourseProgressTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return (
    message.includes('course_lesson_student_progress') ||
    message.includes('course_modules') ||
    message.includes('course_lesson_sessions') ||
    message.includes('sanity_lesson_id') ||
    message.includes('does not exist') ||
    message.includes('Could not find')
  );
}

function hasWatchedProgress(progress: CourseLessonStudentProgress | undefined): boolean {
  if (!progress) return false;
  return !!(progress.live_attended_at || progress.recording_watched_at);
}

function isLessonCompleted(progress: CourseLessonStudentProgress | undefined): boolean {
  if (!progress?.completed_at) return false;
  return true;
}

/** Вычисляет статус точки на карте курса. */
export function computeMapStopStatus(params: {
  hasAccess: boolean;
  accessBlocked: boolean;
  accessStatus: string | null;
  sessionStatus: WebinarSessionStatus | null;
  progress: CourseLessonStudentProgress | undefined;
  isCurrent: boolean;
}): CourseMapStopStatus {
  if (!params.hasAccess || params.accessStatus === 'revoked') return 'locked';
  if (params.accessBlocked && params.accessStatus === 'blocked_lives') return 'locked';
  if (isLessonCompleted(params.progress)) return 'done';
  if (params.sessionStatus === 'completed' && hasWatchedProgress(params.progress)) {
    if (params.progress?.homework_status !== 'approved') return 'watched';
  }
  if (params.sessionStatus === 'completed') return 'watched';
  if (params.sessionStatus === 'live') return 'now';
  if (params.isCurrent) return 'now';
  if (params.hasAccess) return 'now';
  return 'locked';
}

export function computeMapAccessState(params: {
  hasAccess: boolean;
  previousCleared: boolean;
  hasCourseProductAccess: boolean;
  accessStatus: string | null;
  isTrialFree: boolean;
  courseState: CourseCabinetState;
  sessionStatus: WebinarSessionStatus | null;
  stopStatus: CourseMapStopStatus;
  /** Занятие входит в оплаченную квоту пакета (не только строка access). */
  inPackageQuota?: boolean;
}): { mapAccessState: CourseMapAccessState; isScheduleActive: boolean } {
  const sessionPast = params.sessionStatus === 'completed';
  const isScheduleActive =
    params.sessionStatus === 'live' || params.sessionStatus === 'waiting';

  const trialPreviewOnly =
    params.isTrialFree &&
    params.courseState === 'enrolled_locked' &&
    !params.hasCourseProductAccess;

  /** Пробное не входит в пакет и не бывает «неоплаченным» на карте после записи. */
  if (params.isTrialFree && params.courseState !== 'preview') {
    if (params.stopStatus === 'done') {
      return { mapAccessState: 'completed', isScheduleActive };
    }
    return { mapAccessState: 'available', isScheduleActive };
  }

  const paidInPackage =
    Boolean(params.inPackageQuota) ||
    params.accessStatus === 'available' ||
    params.accessStatus === 'blocked_lives' ||
    trialPreviewOnly;

  if (params.stopStatus === 'done') {
    return { mapAccessState: 'completed', isScheduleActive };
  }

  if (!params.hasCourseProductAccess && !trialPreviewOnly) {
    return {
      mapAccessState: sessionPast ? 'locked_unpaid_past' : 'locked_unpaid',
      isScheduleActive,
    };
  }

  if (params.hasCourseProductAccess && !paidInPackage) {
    return {
      mapAccessState: sessionPast ? 'locked_unpaid_past' : 'locked_unpaid',
      isScheduleActive,
    };
  }

  if (paidInPackage && params.hasAccess && params.previousCleared) {
    return { mapAccessState: 'available', isScheduleActive };
  }

  if (paidInPackage && !params.previousCleared) {
    return {
      mapAccessState: sessionPast ? 'locked_prerequisite_past' : 'locked_prerequisite',
      isScheduleActive,
    };
  }

  return {
    mapAccessState: sessionPast ? 'locked_unpaid_past' : 'locked_unpaid',
    isScheduleActive,
  };
}

function resolveLessonAccess(params: {
  courseState: CourseCabinetState;
  hasCourseProductAccess: boolean;
  accessStatus: string | null;
  isTrialFree: boolean;
  previousCleared: boolean;
}): { hasAccess: boolean; accessStatus: string | null } {
  if (params.courseState === 'preview') {
    return { hasAccess: false, accessStatus: null };
  }
  if (!params.previousCleared) {
    return { hasAccess: false, accessStatus: params.accessStatus };
  }
  if (params.accessStatus === 'available' || params.accessStatus === 'blocked_lives') {
    return { hasAccess: true, accessStatus: params.accessStatus };
  }
  if (params.accessStatus === 'revoked') {
    return { hasAccess: false, accessStatus: params.accessStatus };
  }
  // Пробное без строки access (ещё не выдали) — только в enrolled_locked
  if (params.courseState === 'enrolled_locked' && params.isTrialFree) {
    return { hasAccess: true, accessStatus: 'available' };
  }
  return { hasAccess: false, accessStatus: null };
}

async function mergeLegacyLessonAccess(
  admin: SupabaseClient,
  telegramId: number,
  content: DistrictCourseContent,
  sanityLessonIds: string[],
  accessMap: Map<string, string>,
): Promise<void> {
  const { data: legacyRows, error } = await admin
    .from('course_lesson_access')
    .select('course_lesson_id, access_status')
    .eq('telegram_id', telegramId)
    .is('sanity_lesson_id', null)
    .neq('access_status', 'revoked');
  if (error) throw error;
  if (!legacyRows?.length) return;

  const courseLessonIds = legacyRows
    .map((row) => row.course_lesson_id as number | null)
    .filter((id): id is number => id != null);
  if (courseLessonIds.length === 0) return;

  const { data: catalogRows, error: catalogError } = await admin
    .from('course_lessons')
    .select('id, lesson_index')
    .in('id', courseLessonIds);
  if (catalogError) throw catalogError;

  const lessonNumberToSanity = new Map<number, string>();
  for (const lesson of flattenCourseLessons(content)) {
    lessonNumberToSanity.set(lesson.lessonNumber, lesson.sanityId);
  }

  for (const row of legacyRows) {
    const catalog = (catalogRows ?? []).find((item) => item.id === row.course_lesson_id);
    if (!catalog) continue;
    const sanityId = lessonNumberToSanity.get(catalog.lesson_index as number);
    if (!sanityId || !sanityLessonIds.includes(sanityId) || accessMap.has(sanityId)) continue;
    accessMap.set(sanityId, row.access_status as string);
  }
}

async function loadProgressAndAccessBySanity(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonIds: string[],
  content?: DistrictCourseContent,
): Promise<{
  accessMap: Map<string, string>;
  progressMap: Map<string, CourseLessonStudentProgress>;
}> {
  if (sanityLessonIds.length === 0) {
    return { accessMap: new Map(), progressMap: new Map() };
  }

  const [{ data: accessRows }, { data: progressRows }] = await Promise.all([
    admin
      .from('course_lesson_access')
      .select('sanity_lesson_id, access_status')
      .eq('telegram_id', telegramId)
      .in('sanity_lesson_id', sanityLessonIds),
    admin
      .from('course_lesson_student_progress')
      .select('*')
      .eq('telegram_id', telegramId)
      .in('sanity_lesson_id', sanityLessonIds),
  ]);

  const accessMap = new Map(
    (accessRows ?? []).map((r) => [r.sanity_lesson_id as string, r.access_status as string]),
  );
  if (content) {
    await mergeLegacyLessonAccess(admin, telegramId, content, sanityLessonIds, accessMap);
  }

  return {
    accessMap,
    progressMap: new Map(
      (progressRows ?? []).map((r) => [
        r.sanity_lesson_id as string,
        normalizeProgressRow(r as CourseLessonStudentProgress),
      ]),
    ),
  };
}

/** Карта курса из Sanity + состояние ученика в Supabase. */
export async function buildCourseMapStopsFromContent(
  admin: SupabaseClient,
  telegramId: number,
  content: DistrictCourseContent,
  accessBlocked: boolean,
  options: {
    courseState: CourseCabinetState;
    hasCourseProductAccess: boolean;
    fullyBlocked?: boolean;
  },
): Promise<CourseMapStop[]> {
  const fullyBlocked = Boolean(options.fullyBlocked);
  const allLessons = flattenCourseLessons(content);
  const allSanityIds = allLessons.map((l) => l.sanityId);
  const [{ accessMap, progressMap }, { data: allProgressRows }, sessionMap] = await Promise.all([
    loadProgressAndAccessBySanity(admin, telegramId, allSanityIds, content),
    admin
      .from('course_lesson_student_progress')
      .select('sanity_lesson_id')
      .eq('telegram_id', telegramId)
      .not('sanity_lesson_id', 'is', null),
    loadSanityLessonSessionMap(admin, allSanityIds),
  ]);

  const progressSanityIds = new Set(
    (allProgressRows ?? []).map((r) => r.sanity_lesson_id as string).filter(Boolean),
  );

  const visibleLessons: { lesson: CourseLessonContent; moduleIndex: number; numInModule: number }[] =
    [];
  content.modules.forEach((mod, moduleIndex) => {
    let numInModule = 0;
    for (const lesson of mod.lessons) {
      // Черновики и архив без прогресса не показываем на карте.
      if (!isLessonVisible(lesson, progressSanityIds)) continue;
      numInModule += 1;
      visibleLessons.push({ lesson, moduleIndex, numInModule });
    }
  });

  // Проверяем сценарий в course_enrollments
  const { resolveCourseIdForContent } = await import('./course-record');
  const courseId = await resolveCourseIdForContent(admin, content);
  let scenario: 'start_from_beginning' | 'join_current' | null = null;
  let startLessonSanityId: string | null = null;
  
  let enrollmentRow: {
    purchase_scenario?: string | null;
    start_lesson_id?: number | null;
    start_module_id?: number | null;
  } | null = null;

  if (courseId) {
    const { data: enrollment } = await admin
      .from('course_enrollments')
      .select('purchase_scenario, start_lesson_id, start_module_id')
      .eq('telegram_id', telegramId)
      .eq('course_id', courseId)
      .maybeSingle();
    enrollmentRow = enrollment;

    scenario = enrollment?.purchase_scenario as 'start_from_beginning' | 'join_current' | null;

    const { resolveEnrollmentStartLessonSanityId } = await import('./course-enrollment-start');
    startLessonSanityId = await resolveEnrollmentStartLessonSanityId(
      admin,
      courseId,
      content,
      enrollment,
    );
  }

  const orderedLessons = visibleLessons.map((v) => v.lesson);

  const { determineActiveModule } = await import('./active-module');
  const streamModuleResult = await determineActiveModule(admin, content);
  const streamActiveModuleIndex =
    streamModuleResult.module != null
      ? content.modules.findIndex((m) => m.sanityId === streamModuleResult.module!.sanityId)
      : -1;

  const joinStartIndex =
    scenario === 'join_current' && startLessonSanityId
      ? orderedLessons.findIndex((l) => l.sanityId === startLessonSanityId)
      : 0;
  const gateStartIndex = joinStartIndex > 0 ? joinStartIndex : 0;
  const progressForGate = new Map<string, CourseLessonStudentProgress | undefined>();
  for (const { lesson } of visibleLessons) {
    progressForGate.set(lesson.sanityId, progressMap.get(lesson.sanityId));
  }

  // Для join_current: определяем startIndex и помечаем архивные уроки
  const isArchiveLesson = new Set<string>();
  
  if (scenario === 'join_current' && startLessonSanityId) {
    const startLessonIndex = orderedLessons.findIndex((l) => l.sanityId === startLessonSanityId);
    if (startLessonIndex >= 0) {
      // Помечаем уроки до стартового как архив
      for (let i = 0; i < startLessonIndex; i++) {
        isArchiveLesson.add(orderedLessons[i]?.sanityId ?? '');
      }
    }
  }

  const packageEntitlement = await sumCoursePackageLessonEntitlement(admin, telegramId);
  const effectiveHasCourseProduct =
    options.hasCourseProductAccess && packageEntitlement > 0;
  let paidLessonSlotIndex = 0;

  let firstChainGateSanityId: string | null = null;
  let scanPaidSlotIndex = 0;
  for (let lessonIndex = 0; lessonIndex < visibleLessons.length; lessonIndex += 1) {
    const { lesson } = visibleLessons[lessonIndex]!;
    const isArchive = isArchiveLesson.has(lesson.sanityId);
    const effectivePreviousCleared = isArchive
      ? true
      : previousCourseLessonsCleared(orderedLessons, lessonIndex, progressForGate, {
          hasCourseProduct: effectiveHasCourseProduct,
          gateStartIndex,
        });
    let inQuota = false;
    if (isArchive) {
      inQuota = effectiveHasCourseProduct;
    } else if (lesson.isTrialFree) {
      inQuota = effectiveHasCourseProduct || options.courseState === 'enrolled_locked';
    } else if (effectiveHasCourseProduct && packageEntitlement > 0) {
      if (lessonIndex >= gateStartIndex) {
        inQuota = scanPaidSlotIndex < packageEntitlement;
        scanPaidSlotIndex += 1;
      }
    }
    if (
      inQuota &&
      !effectivePreviousCleared &&
      !lesson.isTrialFree &&
      !firstChainGateSanityId
    ) {
      firstChainGateSanityId = lesson.sanityId;
    }
  }

  paidLessonSlotIndex = 0;

  const accessibleIncomplete = fullyBlocked
    ? []
    : visibleLessons
        .filter(({ lesson }, index) => {
          if (isArchiveLesson.has(lesson.sanityId)) return false;

          const access = resolveLessonAccess({
            courseState: options.courseState,
            hasCourseProductAccess: effectiveHasCourseProduct,
            accessStatus: accessMap.get(lesson.sanityId) ?? null,
            isTrialFree: lesson.isTrialFree,
            previousCleared: previousCourseLessonsCleared(orderedLessons, index, progressForGate, {
              hasCourseProduct: effectiveHasCourseProduct,
              gateStartIndex,
            }),
          });
          if (!access.hasAccess) return false;
          const accessStatus = access.accessStatus;
          if (accessBlocked && accessStatus === 'blocked_lives') return false;
          return !isCourseLessonCleared(lesson, progressForGate.get(lesson.sanityId), {
            hasCourseProduct: effectiveHasCourseProduct,
          });
        })
        .sort((a, b) => a.lesson.lessonNumber - b.lesson.lessonNumber);
  const currentSanityId = accessibleIncomplete[0]?.lesson.sanityId ?? null;

  return visibleLessons.map(({ lesson, moduleIndex, numInModule }, lessonIndex) => {
    const isJoinArchive = isArchiveLesson.has(lesson.sanityId);

    const effectivePreviousCleared = isJoinArchive
      ? true
      : previousCourseLessonsCleared(orderedLessons, lessonIndex, progressForGate, {
          hasCourseProduct: effectiveHasCourseProduct,
          gateStartIndex,
        });
    
    const access = resolveLessonAccess({
      courseState: options.courseState,
      hasCourseProductAccess: effectiveHasCourseProduct,
      accessStatus: accessMap.get(lesson.sanityId) ?? null,
      isTrialFree: lesson.isTrialFree,
      previousCleared: effectivePreviousCleared,
    });
    const progress = progressMap.get(lesson.sanityId);
    const sessionStatus =
      lesson.lessonType === 'webinar'
        ? resolveWebinarSessionStatus(
            lesson.scheduledAt,
            sessionMap.get(lesson.sanityId),
          )
        : null;
    const status = computeMapStopStatus({
      hasAccess: fullyBlocked ? false : access.hasAccess,
      accessBlocked,
      accessStatus: access.accessStatus,
      sessionStatus,
      progress,
      isCurrent: !fullyBlocked && lesson.sanityId === currentSanityId,
    });
    const rawAccessStatus = accessMap.get(lesson.sanityId) ?? null;
    let inPackageQuota = false;
    if (isJoinArchive) {
      inPackageQuota = effectiveHasCourseProduct;
    } else if (lesson.isTrialFree) {
      inPackageQuota =
        effectiveHasCourseProduct || options.courseState === 'enrolled_locked';
    } else if (effectiveHasCourseProduct && packageEntitlement > 0 && lessonIndex >= gateStartIndex) {
      inPackageQuota = paidLessonSlotIndex < packageEntitlement;
      paidLessonSlotIndex += 1;
    }
    const { mapAccessState, isScheduleActive } = computeMapAccessState({
      hasAccess: fullyBlocked ? false : access.hasAccess,
      previousCleared: effectivePreviousCleared,
      hasCourseProductAccess: effectiveHasCourseProduct,
      accessStatus: rawAccessStatus,
      isTrialFree: lesson.isTrialFree,
      courseState: options.courseState,
      sessionStatus,
      stopStatus: status,
      inPackageQuota,
    });

    return {
      sanityLessonId: lesson.sanityId,
      lessonId: null,
      lessonIndex,
      moduleIndex,
      numInModule,
      isCurrent: lesson.sanityId === currentSanityId,
      title: lesson.title,
      description: lesson.description,
      kind: mapLessonKind(lesson.lessonType),
      status,
      sessionStartsAt: lesson.scheduledAt,
      liveUrl: lesson.liveUrl,
      recordingUrl: lesson.recordingUrl,
      sessionStatus,
      mandatoryHomework: isJoinArchive
        ? false
        : homeworkRequiredForLesson(lesson, effectiveHasCourseProduct, {
            isJoinArchive: isJoinArchive,
          }),
      homeworkStatus:
        isJoinArchive || (lesson.isTrialFree && !effectiveHasCourseProduct)
          ? null
          : (progress?.homework_status ?? null),
      homeworkTitle: lesson.homework?.title ?? null,
      homeworkReviewNote: progress?.review_note ?? null,
      homeworkCompletedAt: progress?.homework_completed_at ?? null,
      homeworkDeadlineAt:
        isJoinArchive || (lesson.isTrialFree && !effectiveHasCourseProduct)
          ? null
          : (progress?.homework_deadline_at ?? null),
      homeworkRemainingMs:
        isJoinArchive || (lesson.isTrialFree && !effectiveHasCourseProduct)
          ? null
          : typeof progress?.homework_remaining_ms === 'number'
            ? progress.homework_remaining_ms
            : null,
      homeworkOverdueAt:
        isJoinArchive || (lesson.isTrialFree && !effectiveHasCourseProduct)
          ? null
          : (progress?.homework_overdue_at ?? null),
      lessonProgressPercent:
        isJoinArchive && effectiveHasCourseProduct
          ? 100
          : computeLessonProgressPercent({
              recordingWatchedAt: progress?.recording_watched_at,
              liveAttendedAt: progress?.live_attended_at,
              homeworkStatus: isJoinArchive ? null : progress?.homework_status,
              hasHomework: isJoinArchive
                ? false
                : homeworkRequiredForLesson(lesson, effectiveHasCourseProduct, {
                    isJoinArchive,
                  }),
            }),
      isTrialFree: lesson.isTrialFree,
      contentChips:
        lesson.contentChips?.length > 0
          ? lesson.contentChips
          : [...DEFAULT_LESSON_CONTENT_CHIPS],
      materials: lesson.materials.map((m) => ({

        title: m.title,
        fileName: m.fileName,
        fileSize: m.fileSize,
        url: m.url,
      })),
      homeworkFiles: lesson.homeworkFiles.map((m) => ({
        title: m.title,
        fileName: m.fileName,
        fileSize: m.fileSize,
        url: m.url,
      })),
      mapAccessState,
      isScheduleActive,
      isFirstChainGate: lesson.sanityId === firstChainGateSanityId,
      isJoinArchive,
      isStreamActiveModule: moduleIndex === streamActiveModuleIndex,
    };
  });
}

/** Структура курса для карты без прогресса (все остановки locked). */
export function buildCourseStructureStopsFromContent(content: DistrictCourseContent): CourseMapStop[] {
  const out: CourseMapStop[] = [];
  let lessonIndex = 0;
  const emptyProgress = new Set<string>();
  content.modules.forEach((mod, moduleIndex) => {
    let numInModule = 0;
    for (const lesson of mod.lessons) {
      if (!isLessonVisible(lesson, emptyProgress)) continue;
      numInModule += 1;
      const sessionStatus =
        lesson.lessonType === 'webinar'
          ? defaultWebinarSessionStatus(lesson.scheduledAt)
          : null;
      out.push({
        sanityLessonId: lesson.sanityId,
        lessonId: null,
        lessonIndex,
        moduleIndex,
        numInModule,
        isCurrent: false,
        title: lesson.title,
        description: lesson.description,
        kind: mapLessonKind(lesson.lessonType),
        status: 'locked',
        sessionStartsAt: lesson.scheduledAt,
        liveUrl: lesson.liveUrl,
        recordingUrl: lesson.recordingUrl,
        sessionStatus,
        mandatoryHomework: lesson.mandatoryHomework,
        homeworkStatus: null,
        homeworkTitle: lesson.homework?.title ?? null,
        homeworkReviewNote: null,
        homeworkCompletedAt: null,
        homeworkDeadlineAt: null,
        homeworkRemainingMs: null,
        homeworkOverdueAt: null,
        lessonProgressPercent: 0,
        isTrialFree: lesson.isTrialFree,
        contentChips:
          lesson.contentChips?.length > 0
            ? lesson.contentChips
            : [...DEFAULT_LESSON_CONTENT_CHIPS],
        materials: lesson.materials.map((m) => ({
          title: m.title,
          fileName: m.fileName,
          fileSize: m.fileSize,
          url: m.url,
        })),
        homeworkFiles: lesson.homeworkFiles.map((m) => ({
          title: m.title,
          fileName: m.fileName,
          fileSize: m.fileSize,
          url: m.url,
        })),
        mapAccessState: 'locked_unpaid',
        isScheduleActive: sessionStatus === 'live' || sessionStatus === 'waiting',
        isFirstChainGate: false,
        isJoinArchive: false,
        isStreamActiveModule: false,
      });
      lessonIndex += 1;
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Legacy: Supabase catalog (fallback если Sanity пуст)
// ---------------------------------------------------------------------------

export async function loadCourseCatalog(
  admin: SupabaseClient,
  courseId: number,
): Promise<{ modules: CourseModuleRow[]; lessons: CourseLessonCatalogRow[] }> {
  const { data: modules, error: modError } = await admin
    .from('course_modules')
    .select('id, course_id, title, color, about, sort_order, lesson_count')
    .eq('course_id', courseId)
    .order('sort_order', { ascending: true });
  if (modError) throw modError;

  const { data: lessons, error: lessonError } = await admin
    .from('course_lessons')
    .select('id, course_id, module_id, lesson_index, num_in_module, title, kind, is_trial_free')
    .eq('course_id', courseId)
    .order('lesson_index', { ascending: true });
  if (lessonError) throw lessonError;

  return {
    modules: (modules ?? []) as CourseModuleRow[],
    lessons: (lessons ?? []) as CourseLessonCatalogRow[],
  };
}

export async function buildCourseMapStops(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  accessBlocked: boolean,
): Promise<CourseMapStop[]> {
  const { modules, lessons } = await loadCourseCatalog(admin, courseId);
  const moduleOrder = new Map(modules.map((m, i) => [m.id, i]));

  const lessonIds = lessons.map((l) => l.id);
  if (lessonIds.length === 0) return [];

  const [{ data: accessRows }, { data: progressRows }, { data: sessionRows }] = await Promise.all([
    admin
      .from('course_lesson_access')
      .select('course_lesson_id, access_status')
      .eq('telegram_id', telegramId)
      .in('course_lesson_id', lessonIds),
    admin
      .from('course_lesson_student_progress')
      .select('*')
      .eq('telegram_id', telegramId)
      .in('course_lesson_id', lessonIds),
    admin
      .from('course_lesson_sessions')
      .select('course_lesson_id, starts_at, live_url, recording_url, status')
      .in('course_lesson_id', lessonIds),
  ]);

  const accessMap = new Map(
    (accessRows ?? []).map((r) => [r.course_lesson_id as number, r.access_status as string]),
  );
  const progressMap = new Map(
    (progressRows ?? []).map((r) => [r.course_lesson_id as number, r as CourseLessonStudentProgress]),
  );
  const sessionMap = new Map(
    (sessionRows ?? []).map((r) => [r.course_lesson_id as number, r as CourseLessonSessionRow]),
  );

  const accessibleIncomplete = lessons.filter((l) => {
    const access = accessMap.get(l.id);
    if (!access || access === 'revoked') return false;
    if (accessBlocked && access === 'blocked_lives') return false;
    return !progressMap.get(l.id)?.completed_at;
  });
  const currentLessonId = accessibleIncomplete[0]?.id ?? null;

  return lessons.map((lesson) => {
    const accessStatus = accessMap.get(lesson.id) ?? null;
    const hasAccess = accessStatus === 'available' || accessStatus === 'blocked_lives';
    const session = sessionMap.get(lesson.id);
    const progress = progressMap.get(lesson.id);
    const status = computeMapStopStatus({
      hasAccess,
      accessBlocked,
      accessStatus,
      sessionStatus: session?.status ?? null,
      progress,
      isCurrent: lesson.id === currentLessonId,
    });
    const { mapAccessState, isScheduleActive } = computeMapAccessState({
      hasAccess,
      previousCleared: hasAccess,
      hasCourseProductAccess: true,
      accessStatus: accessStatus,
      isTrialFree: Boolean(lesson.is_trial_free),
      courseState: 'full',
      sessionStatus: session?.status ?? null,
      stopStatus: status,
    });

    return {
      sanityLessonId: null,
      lessonId: lesson.id,
      lessonIndex: lesson.lesson_index,
      moduleIndex: moduleOrder.get(lesson.module_id) ?? 0,
      numInModule: lesson.num_in_module,
      isCurrent: lesson.id === currentLessonId,
      title: lesson.title,
      description: null,
      kind: lesson.kind,
      status,
      sessionStartsAt: session?.starts_at ?? null,
      liveUrl: session?.live_url ?? null,
      recordingUrl: session?.recording_url ?? null,
      sessionStatus: session?.status ?? null,
      mandatoryHomework: true,
      homeworkStatus: progress?.homework_status ?? null,
      homeworkTitle: null,
      homeworkReviewNote: progress?.review_note ?? null,
      homeworkCompletedAt: progress?.homework_completed_at ?? null,
      homeworkDeadlineAt: progress?.homework_deadline_at ?? null,
      homeworkRemainingMs:
        typeof progress?.homework_remaining_ms === 'number' ? progress.homework_remaining_ms : null,
      homeworkOverdueAt: progress?.homework_overdue_at ?? null,
      lessonProgressPercent: 0,
      isTrialFree: Boolean(lesson.is_trial_free),
      contentChips: [...DEFAULT_LESSON_CONTENT_CHIPS],
      materials: [],
      homeworkFiles: [],
      mapAccessState,
      isScheduleActive,
      isFirstChainGate: false,
      isJoinArchive: false,
      isStreamActiveModule: false,
    };
  });
}

type LessonProgressKey =
  | { sanityLessonId: string; courseLessonId?: null }
  | { sanityLessonId?: null; courseLessonId: number };

/**
 * Partial unique index на (telegram_id, sanity_lesson_id) ломает PostgREST upsert —
 * пишем через update / insert.
 */
async function writeProgressRow(
  admin: SupabaseClient,
  telegramId: number,
  key: LessonProgressKey,
  patch: Record<string, unknown>,
): Promise<CourseLessonStudentProgress> {
  const filter =
    key.sanityLessonId != null
      ? { sanity_lesson_id: key.sanityLessonId }
      : { course_lesson_id: key.courseLessonId };

  const { data: existing, error: findError } = await admin
    .from('course_lesson_student_progress')
    .select('id')
    .eq('telegram_id', telegramId)
    .match(filter)
    .maybeSingle();
  if (findError) throw findError;

  if (existing?.id) {
    const { data, error } = await admin
      .from('course_lesson_student_progress')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return normalizeProgressRow(data as CourseLessonStudentProgress);
  }

  const insertRow: Record<string, unknown> = {
    telegram_id: telegramId,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  if (key.sanityLessonId != null) {
    insertRow.sanity_lesson_id = key.sanityLessonId;
    insertRow.course_lesson_id = null;
  } else {
    insertRow.course_lesson_id = key.courseLessonId;
  }

  const { data, error } = await admin
    .from('course_lesson_student_progress')
    .insert(insertRow)
    .select('*')
    .single();
  if (error) throw error;
  return normalizeProgressRow(data as CourseLessonStudentProgress);
}

export async function markRecordingWatched(
  admin: SupabaseClient,
  telegramId: number,
  key: LessonProgressKey,
  _watchPercent?: number,
): Promise<CourseLessonStudentProgress> {
  const now = new Date().toISOString();
  return writeProgressRow(admin, telegramId, key, {
    recording_watched_at: now,
    watch_percent: 100,
  });
}

export async function markLiveAttended(
  admin: SupabaseClient,
  telegramId: number,
  key: LessonProgressKey,
  _watchPercent?: number,
): Promise<CourseLessonStudentProgress> {
  const now = new Date().toISOString();
  return writeProgressRow(admin, telegramId, key, {
    live_attended_at: now,
    watch_percent: 100,
  });
}

export async function markHomeworkApproved(
  admin: SupabaseClient,
  telegramId: number,
  key: LessonProgressKey,
  reviewNote?: string,
  options?: { materialKeys?: string[]; hasHomework?: boolean },
): Promise<CourseLessonStudentProgress> {
  const now = new Date().toISOString();
  const filter =
    key.sanityLessonId != null
      ? { sanity_lesson_id: key.sanityLessonId }
      : { course_lesson_id: key.courseLessonId };

  const { data: existing } = await admin
    .from('course_lesson_student_progress')
    .select('*')
    .eq('telegram_id', telegramId)
    .match(filter)
    .maybeSingle();

  const existingNorm = existing
    ? normalizeProgressRow(existing as CourseLessonStudentProgress)
    : null;
  const hasHomework = options?.hasHomework ?? true;
  const fullyDone = isLessonProgressCompleted({
    recordingWatchedAt: existingNorm?.recording_watched_at,
    liveAttendedAt: existingNorm?.live_attended_at,
    homeworkStatus: 'approved',
    hasHomework,
  });

  return writeProgressRow(admin, telegramId, key, {
    homework_status: 'approved',
    homework_completed_at: now,
    review_note: reviewNote?.trim() || null,
    completed_at: fullyDone ? now : null,
  });
}

/** @deprecated вариант B — в A не используется UI, оставлен для API-совместимости */
export async function reportWatchPercent(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  watchPercent: number,
): Promise<CourseLessonStudentProgress> {
  const pct = Math.max(0, Math.min(100, Math.round(watchPercent)));
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { watch_percent: pct };
  if (pct >= 50) patch.recording_watched_at = now;
  return writeProgressRow(admin, telegramId, { sanityLessonId }, patch);
}

/** @deprecated вариант B */
export async function reportMaterialOpened(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  materialKey: string,
): Promise<CourseLessonStudentProgress> {
  const key = materialKey.trim();
  if (!key) throw new Error('Empty material key');
  const { data: existing } = await admin
    .from('course_lesson_student_progress')
    .select('*')
    .eq('telegram_id', telegramId)
    .eq('sanity_lesson_id', sanityLessonId)
    .maybeSingle();
  const prev = existing ? normalizeProgressRow(existing as CourseLessonStudentProgress) : null;
  const opened = new Set(prev?.materials_opened ?? []);
  opened.add(key);
  return writeProgressRow(admin, telegramId, { sanityLessonId }, {
    materials_opened: [...opened],
  });
}

export function countCompletedLessons(stops: CourseMapStop[]): number {
  return stops.filter((s) => s.status === 'done').length;
}

export function countPassedLessons(stops: CourseMapStop[]): number {
  return stops.filter((s) => s.status === 'done' || s.status === 'watched').length;
}

export function modulesFromContent(content: DistrictCourseContent): CourseModuleRow[] {
  return content.modules.map((mod, i) => ({
    id: i,
    course_id: 0,
    title: mod.title,
    color: mod.color,
    about: mod.description,
    sort_order: mod.sortOrder,
    lesson_count: mod.lessons.filter((l) => l.publicationStatus === 'published').length,
  }));
}
