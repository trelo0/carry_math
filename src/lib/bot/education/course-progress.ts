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

type CourseCabinetState = 'preview' | 'enrolled_locked' | 'full';

export type CourseMapStopStatus = 'locked' | 'now' | 'watched' | 'done';

export type HomeworkProgressStatus = 'pending' | 'submitted' | 'approved' | 'rejected';

export type CourseLessonStudentProgress = {
  id: number;
  telegram_id: number;
  course_lesson_id: number | null;
  sanity_lesson_id: string | null;
  live_attended_at: string | null;
  recording_watched_at: string | null;
  homework_status: HomeworkProgressStatus;
  homework_submitted_at: string | null;
  homework_completed_at: string | null;
  submission_note: string | null;
  submission_file_url: string | null;
  review_note: string | null;
  completed_at: string | null;
  updated_at: string;
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
  contentChips: string[];
  materials: { title: string; fileName: string | null; fileSize: string | null; url: string | null }[];
  homeworkFiles: { title: string; fileName: string | null; fileSize: string | null; url: string | null }[];
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

function resolveLessonAccess(params: {
  courseState: CourseCabinetState;
  hasCourseProductAccess: boolean;
  accessStatus: string | null;
  isTrialFree: boolean;
}): { hasAccess: boolean; accessStatus: string | null } {
  if (params.courseState === 'preview') {
    return { hasAccess: false, accessStatus: null };
  }
  if (params.accessStatus === 'available' || params.accessStatus === 'blocked_lives') {
    return { hasAccess: true, accessStatus: params.accessStatus };
  }
  if (params.accessStatus === 'revoked') {
    return { hasAccess: false, accessStatus: params.accessStatus };
  }
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
      (progressRows ?? []).map((r) => [r.sanity_lesson_id as string, r as CourseLessonStudentProgress]),
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
  },
): Promise<CourseMapStop[]> {
  const allLessons = flattenCourseLessons(content);
  const [{ progressMap: initialProgress }, { data: allProgressRows }] = await Promise.all([
    loadProgressAndAccessBySanity(
      admin,
      telegramId,
      allLessons.map((l) => l.sanityId),
      content,
    ),
    admin
      .from('course_lesson_student_progress')
      .select('sanity_lesson_id')
      .eq('telegram_id', telegramId)
      .not('sanity_lesson_id', 'is', null),
  ]);

  const progressSanityIds = new Set(
    (allProgressRows ?? []).map((r) => r.sanity_lesson_id as string).filter(Boolean),
  );

  const visibleLessons: { lesson: CourseLessonContent; moduleIndex: number; numInModule: number }[] =
    [];
  content.modules.forEach((mod, moduleIndex) => {
    let numInModule = 0;
    for (const lesson of mod.lessons) {
      if (lesson.publicationStatus === 'archived' && !progressSanityIds.has(lesson.sanityId)) continue;
      numInModule += 1;
      visibleLessons.push({ lesson, moduleIndex, numInModule });
    }
  });

  const sanityIds = visibleLessons.map((v) => v.lesson.sanityId);
  const [{ accessMap, progressMap }, sessionMap] = await Promise.all([
    loadProgressAndAccessBySanity(admin, telegramId, sanityIds, content),
    loadSanityLessonSessionMap(admin, sanityIds),
  ]);

  const accessibleIncomplete = visibleLessons
    .filter(({ lesson }) => {
      const access = resolveLessonAccess({
        courseState: options.courseState,
        hasCourseProductAccess: options.hasCourseProductAccess,
        accessStatus: accessMap.get(lesson.sanityId) ?? null,
        isTrialFree: lesson.isTrialFree,
      });
      if (!access.hasAccess) return false;
      const accessStatus = access.accessStatus;
      if (accessBlocked && accessStatus === 'blocked_lives') return false;
      return !progressMap.get(lesson.sanityId)?.completed_at;
    })
    .sort((a, b) => a.lesson.lessonNumber - b.lesson.lessonNumber);
  const currentSanityId = accessibleIncomplete[0]?.lesson.sanityId ?? null;

  return visibleLessons.map(({ lesson, moduleIndex, numInModule }, lessonIndex) => {
    const access = resolveLessonAccess({
      courseState: options.courseState,
      hasCourseProductAccess: options.hasCourseProductAccess,
      accessStatus: accessMap.get(lesson.sanityId) ?? null,
      isTrialFree: lesson.isTrialFree,
    });
    const progress = progressMap.get(lesson.sanityId) ?? initialProgress.get(lesson.sanityId);
    const sessionStatus =
      lesson.lessonType === 'webinar'
        ? resolveWebinarSessionStatus(
            lesson.scheduledAt,
            sessionMap.get(lesson.sanityId),
          )
        : null;
    const status = computeMapStopStatus({
      hasAccess: access.hasAccess,
      accessBlocked,
      accessStatus: access.accessStatus,
      sessionStatus,
      progress,
      isCurrent: lesson.sanityId === currentSanityId,
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
      mandatoryHomework: lesson.mandatoryHomework,
      homeworkStatus: progress?.homework_status ?? null,
      homeworkTitle: lesson.homework?.title ?? null,
      homeworkReviewNote: progress?.review_note ?? null,
      homeworkCompletedAt: progress?.homework_completed_at ?? null,
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
    };
  });
}

/** Структура курса для карты без прогресса (все остановки locked). */
export function buildCourseStructureStopsFromContent(content: DistrictCourseContent): CourseMapStop[] {
  const out: CourseMapStop[] = [];
  let lessonIndex = 0;
  content.modules.forEach((mod, moduleIndex) => {
    let numInModule = 0;
    for (const lesson of mod.lessons) {
      if (lesson.publicationStatus === 'archived') continue;
      numInModule += 1;
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
        sessionStatus:
          lesson.lessonType === 'webinar'
            ? defaultWebinarSessionStatus(lesson.scheduledAt)
            : null,
        mandatoryHomework: lesson.mandatoryHomework,
        homeworkStatus: null,
        homeworkTitle: lesson.homework?.title ?? null,
        homeworkReviewNote: null,
        homeworkCompletedAt: null,
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
      contentChips: [...DEFAULT_LESSON_CONTENT_CHIPS],
      materials: [],
      homeworkFiles: [],
    };
  });
}

type LessonProgressKey =
  | { sanityLessonId: string; courseLessonId?: null }
  | { sanityLessonId?: null; courseLessonId: number };

export async function markRecordingWatched(
  admin: SupabaseClient,
  telegramId: number,
  key: LessonProgressKey,
): Promise<CourseLessonStudentProgress> {
  const now = new Date().toISOString();
  const row =
    key.sanityLessonId != null
      ? {
          telegram_id: telegramId,
          sanity_lesson_id: key.sanityLessonId,
          recording_watched_at: now,
          updated_at: now,
        }
      : {
          telegram_id: telegramId,
          course_lesson_id: key.courseLessonId,
          recording_watched_at: now,
          updated_at: now,
        };

  const onConflict = key.sanityLessonId != null ? 'telegram_id,sanity_lesson_id' : 'telegram_id,course_lesson_id';

  const { data, error } = await admin
    .from('course_lesson_student_progress')
    .upsert(row as Record<string, unknown>, { onConflict })
    .select('*')
    .single();
  if (error) throw error;
  return data as CourseLessonStudentProgress;
}

export async function markLiveAttended(
  admin: SupabaseClient,
  telegramId: number,
  key: LessonProgressKey,
): Promise<CourseLessonStudentProgress> {
  const now = new Date().toISOString();
  const row =
    key.sanityLessonId != null
      ? {
          telegram_id: telegramId,
          sanity_lesson_id: key.sanityLessonId,
          live_attended_at: now,
          updated_at: now,
        }
      : {
          telegram_id: telegramId,
          course_lesson_id: key.courseLessonId,
          live_attended_at: now,
          updated_at: now,
        };

  const onConflict = key.sanityLessonId != null ? 'telegram_id,sanity_lesson_id' : 'telegram_id,course_lesson_id';

  const { data, error } = await admin
    .from('course_lesson_student_progress')
    .upsert(row as Record<string, unknown>, { onConflict })
    .select('*')
    .single();
  if (error) throw error;
  return data as CourseLessonStudentProgress;
}

export async function markHomeworkApproved(
  admin: SupabaseClient,
  telegramId: number,
  key: LessonProgressKey,
  reviewNote?: string,
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

  const watched = existing?.live_attended_at || existing?.recording_watched_at;
  const completedAt = watched ? now : null;

  const trimmedReview = reviewNote?.trim() || null;
  const row =
    key.sanityLessonId != null
      ? {
          telegram_id: telegramId,
          sanity_lesson_id: key.sanityLessonId,
          homework_status: 'approved' as const,
          homework_completed_at: now,
          review_note: trimmedReview,
          completed_at: completedAt,
          updated_at: now,
        }
      : {
          telegram_id: telegramId,
          course_lesson_id: key.courseLessonId,
          homework_status: 'approved' as const,
          homework_completed_at: now,
          review_note: trimmedReview,
          completed_at: completedAt,
          updated_at: now,
        };

  const onConflict = key.sanityLessonId != null ? 'telegram_id,sanity_lesson_id' : 'telegram_id,course_lesson_id';

  const { data, error } = await admin
    .from('course_lesson_student_progress')
    .upsert(row as Record<string, unknown>, { onConflict })
    .select('*')
    .single();
  if (error) throw error;
  return data as CourseLessonStudentProgress;
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
