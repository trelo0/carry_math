import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getSanityLessonSession,
  loadSanityLessonSessionMap,
  resolveWebinarSessionStatus,
  type SanityWebinarSessionStatus,
} from '@/lib/curator/lesson-session';
import {
  flattenCourseLessons,
  getDistrictCourseContent,
  type CourseLessonContent,
  type DistrictCourseContent,
} from '@/lib/studio/courseContent';
import {
  markHomeworkApproved,
  type CourseLessonStudentProgress,
  type HomeworkProgressStatus,
} from './course-progress';
import { studentHasCourseProductAccess, unlockNextCourseLessonAfterCleared } from './course-access';
import { collectLessonMaterialKeys, lessonHasHomework } from './lesson-progress-calc';
import { resolveCourseIdForContent } from './course-record';
import {
  deductLifeForHomeworkFailure,
  formatLifeDeductionNote,
  getEnrollmentLives,
  isLivesTableError,
  type HomeworkLifeFailureKind,
} from './lives';
import {
  finalizeDeadlineOnApprove,
  pauseDeadlineOnSubmit,
  resumeDeadlineOnReject,
} from './homework-deadline';

export type CourseHomeworkSubmitInput = {
  note?: string;
  fileUrl?: string;
};

export class CourseHomeworkError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NOT_LINKED'
      | 'LESSON_NOT_FOUND'
      | 'NO_ACCESS'
      | 'NOT_READY'
      | 'ALREADY_SUBMITTED'
      | 'NOT_SUBMITTED'
      | 'NOT_ASSIGNED'
      | 'INVALID_STATUS'
      | 'NOT_REQUIRED',
  ) {
    super(message);
    this.name = 'CourseHomeworkError';
  }
}

export type CourseHomeworkLessonRef = {
  sanityLessonId: string;
  lessonNumber: number;
  title: string;
};

export function findLessonByNumber(
  content: DistrictCourseContent,
  lessonNumber: number,
): CourseLessonContent | null {
  for (const lesson of flattenCourseLessons(content)) {
    if (lesson.publicationStatus !== 'published') continue;
    if (lesson.lessonNumber === lessonNumber) return lesson;
  }
  return null;
}

export function findLessonBySanityId(
  content: DistrictCourseContent,
  sanityLessonId: string,
): CourseLessonContent | null {
  for (const lesson of flattenCourseLessons(content)) {
    if (lesson.sanityId === sanityLessonId) return lesson;
  }
  return null;
}

function hasWatchedProgress(progress: CourseLessonStudentProgress | undefined): boolean {
  return !!(progress?.live_attended_at || progress?.recording_watched_at);
}

function lessonReadyForSubmit(
  lesson: CourseLessonContent,
  progress: CourseLessonStudentProgress | undefined,
  sessionStatus?: SanityWebinarSessionStatus,
): boolean {
  if (!lesson.mandatoryHomework && !lesson.homework) return false;
  const effective =
    lesson.lessonType === 'webinar'
      ? (sessionStatus ?? resolveWebinarSessionStatus(lesson.scheduledAt, null))
      : 'completed';
  if (effective !== 'completed' && !hasWatchedProgress(progress)) return false;
  return true;
}

async function loadProgress(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
): Promise<CourseLessonStudentProgress | null> {
  const { data, error } = await admin
    .from('course_lesson_student_progress')
    .select('*')
    .eq('telegram_id', telegramId)
    .eq('sanity_lesson_id', sanityLessonId)
    .maybeSingle();
  if (error) throw error;
  return (data as CourseLessonStudentProgress | null) ?? null;
}

async function assertLessonAccess(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
): Promise<void> {
  const { data, error } = await admin
    .from('course_lesson_access')
    .select('access_status')
    .eq('telegram_id', telegramId)
    .eq('sanity_lesson_id', sanityLessonId)
    .maybeSingle();
  if (error) throw error;
  const status = data?.access_status as string | undefined;
  if (!status || status === 'revoked') {
    throw new CourseHomeworkError('Нет доступа к этому занятию.', 'NO_ACCESS');
  }
}

export async function assertCuratorAssigned(
  admin: SupabaseClient,
  curatorTelegramId: number,
  studentTelegramId: number,
): Promise<void> {
  const { data, error } = await admin
    .from('mentor_assignments')
    .select('id')
    .eq('telegram_id', studentTelegramId)
    .eq('mentor_telegram_id', curatorTelegramId)
    .eq('kind', 'curator')
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  if (data) return;

  throw new CourseHomeworkError('Ученик не закреплён за этим куратором.', 'NOT_ASSIGNED');
}

export async function resolveSubmitTargetLesson(
  admin: SupabaseClient,
  telegramId: number,
  preferredSanityLessonId?: string,
): Promise<{ lesson: CourseLessonContent; progress: CourseLessonStudentProgress | null } | null> {
  const content = await getDistrictCourseContent();
  if (!content) return null;

  const hasCourseProduct = await studentHasCourseProductAccess(admin, telegramId);

  const lessons = flattenCourseLessons(content)
    .filter((l) => l.publicationStatus === 'published')
    .filter((l) => !(l.isTrialFree && !hasCourseProduct))
    .sort((a, b) => a.lessonNumber - b.lessonNumber);

  const sanityIds = lessons.map((l) => l.sanityId);
  const sessionMap = await loadSanityLessonSessionMap(admin, sanityIds);
  const [{ data: accessRows }, { data: progressRows }] = await Promise.all([
    admin
      .from('course_lesson_access')
      .select('sanity_lesson_id, access_status')
      .eq('telegram_id', telegramId)
      .in('sanity_lesson_id', sanityIds),
    admin
      .from('course_lesson_student_progress')
      .select('*')
      .eq('telegram_id', telegramId)
      .in('sanity_lesson_id', sanityIds),
  ]);

  const accessMap = new Map(
    (accessRows ?? []).map((r) => [r.sanity_lesson_id as string, r.access_status as string]),
  );
  const progressMap = new Map(
    (progressRows ?? []).map((r) => [r.sanity_lesson_id as string, r as CourseLessonStudentProgress]),
  );

  const candidates = lessons.filter((lesson) => {
    const access = accessMap.get(lesson.sanityId);
    if (!access || access === 'revoked') return false;
    const progress = progressMap.get(lesson.sanityId);
    const sessionStatus = resolveWebinarSessionStatus(
      lesson.scheduledAt,
      sessionMap.get(lesson.sanityId),
    );
    if (!lessonReadyForSubmit(lesson, progress, sessionStatus)) return false;
    const status = progress?.homework_status ?? 'pending';
    return status === 'pending' || status === 'rejected';
  });

  if (preferredSanityLessonId) {
    const preferred = candidates.find((l) => l.sanityId === preferredSanityLessonId);
    if (preferred) {
      return { lesson: preferred, progress: progressMap.get(preferred.sanityId) ?? null };
    }
    const direct = await resolveSubmitLessonForSanityId(
      admin,
      telegramId,
      preferredSanityLessonId,
      { content, hasCourseProduct, accessMap, progressMap, sessionMap },
    );
    if (direct) return direct;
  }

  const first = candidates[0];
  if (!first) return null;
  return { lesson: first, progress: progressMap.get(first.sanityId) ?? null };
}

/** Сдача по deep-link из кабинета: конкретное занятие, если оно готово к отправке. */
export async function resolveSubmitLessonForSanityId(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  cached?: {
    content: DistrictCourseContent;
    hasCourseProduct: boolean;
    accessMap: Map<string, string>;
    progressMap: Map<string, CourseLessonStudentProgress>;
    sessionMap: Map<string, import('@/lib/curator/lesson-session').SanityLessonSessionRow>;
  },
): Promise<{ lesson: CourseLessonContent; progress: CourseLessonStudentProgress | null } | null> {
  const content = cached?.content ?? (await getDistrictCourseContent());
  if (!content) return null;
  const hasCourseProduct =
    cached?.hasCourseProduct ?? (await studentHasCourseProductAccess(admin, telegramId));

  const lesson = findLessonBySanityId(content, sanityLessonId);
  if (!lesson || lesson.publicationStatus !== 'published') return null;
  if (lesson.isTrialFree && !hasCourseProduct) return null;

  const accessMap =
    cached?.accessMap ??
    new Map(
      (
        await admin
          .from('course_lesson_access')
          .select('sanity_lesson_id, access_status')
          .eq('telegram_id', telegramId)
          .eq('sanity_lesson_id', sanityLessonId)
      ).data?.map((r) => [r.sanity_lesson_id as string, r.access_status as string]) ?? [],
    );
  const access = accessMap.get(sanityLessonId);
  if (!access || access === 'revoked') return null;

  const progress =
    cached?.progressMap.get(sanityLessonId) ??
    ((await loadProgress(admin, telegramId, sanityLessonId)) as CourseLessonStudentProgress | null);
  const sessionMap =
    cached?.sessionMap ?? (await loadSanityLessonSessionMap(admin, [sanityLessonId]));
  const sessionStatus = resolveWebinarSessionStatus(
    lesson.scheduledAt,
    sessionMap.get(sanityLessonId),
  );
  if (!lessonReadyForSubmit(lesson, progress ?? undefined, sessionStatus)) return null;
  const status = progress?.homework_status ?? 'pending';
  if (status !== 'pending' && status !== 'rejected') return null;

  return { lesson, progress };
}

export async function markHomeworkSubmitted(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  input: CourseHomeworkSubmitInput,
): Promise<CourseLessonStudentProgress> {
  const content = await getDistrictCourseContent();
  if (!content) throw new CourseHomeworkError('Курс не найден.', 'LESSON_NOT_FOUND');
  const lesson = findLessonBySanityId(content, sanityLessonId);
  if (!lesson) throw new CourseHomeworkError('Занятие не найдено.', 'LESSON_NOT_FOUND');

  const hasCourseProduct = await studentHasCourseProductAccess(admin, telegramId);
  if (lesson.isTrialFree && !hasCourseProduct) {
    throw new CourseHomeworkError('Сдача ДЗ доступна после покупки пакета курса.', 'NO_ACCESS');
  }

  const courseIdForGate = await resolveCourseIdForContent(admin, content);
  if (courseIdForGate) {
    const { loadJoinCurrentGateContext, isJoinArchiveSanityId } = await import(
      './course-enrollment-start'
    );
    const joinGate = await loadJoinCurrentGateContext(
      admin,
      telegramId,
      courseIdForGate,
      content,
    );
    if (isJoinArchiveSanityId(joinGate, sanityLessonId)) {
      throw new CourseHomeworkError(
        'Для архивного занятия домашнее задание не требуется.',
        'NOT_REQUIRED',
      );
    }
  }

  try {
    const courseId = courseIdForGate;
    if (courseId) {
      const lives = await getEnrollmentLives(admin, telegramId, courseId);
      if (lives?.fully_blocked) {
        throw new CourseHomeworkError(
          'Курс полностью заблокирован администратором. Материалы недоступны.',
          'NO_ACCESS',
        );
      }
    }
  } catch (error) {
    if (error instanceof CourseHomeworkError) throw error;
    if (!isLivesTableError(error)) throw error;
  }

  await assertLessonAccess(admin, telegramId, sanityLessonId);
  const progress = await loadProgress(admin, telegramId, sanityLessonId);
  const sessionRow = await getSanityLessonSession(admin, sanityLessonId);
  const sessionStatus = resolveWebinarSessionStatus(lesson.scheduledAt, sessionRow);
  if (!lessonReadyForSubmit(lesson, progress ?? undefined, sessionStatus)) {
    throw new CourseHomeworkError('Сначала посмотрите запись или посетите вебинар.', 'NOT_READY');
  }

  const status = progress?.homework_status ?? 'pending';
  if (status === 'submitted') {
    throw new CourseHomeworkError('Домашка уже на проверке.', 'ALREADY_SUBMITTED');
  }
  if (status === 'approved') {
    throw new CourseHomeworkError('Домашка уже принята.', 'INVALID_STATUS');
  }
  if (!input.note?.trim() && !input.fileUrl?.trim()) {
    throw new CourseHomeworkError('Отправьте текст или файл.', 'NOT_READY');
  }

  const nowDate = new Date();
  const now = nowDate.toISOString();
  // Сначала пауза дедлайна (остаток), затем статус — upsert не затирает remaining
  const { remainingMs, wasOverdue } = await pauseDeadlineOnSubmit(
    admin,
    telegramId,
    sanityLessonId,
    nowDate,
  );

  const row: Record<string, unknown> = {
    telegram_id: telegramId,
    sanity_lesson_id: sanityLessonId,
    homework_status: 'submitted',
    homework_submitted_at: now,
    submission_note: input.note?.trim() || null,
    submission_file_url: input.fileUrl?.trim() || null,
    homework_remaining_ms: remainingMs,
    updated_at: now,
  };
  if (wasOverdue) row.homework_overdue_at = now;

  const { data, error } = await admin
    .from('course_lesson_student_progress')
    .upsert(row, { onConflict: 'telegram_id,sanity_lesson_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data as CourseLessonStudentProgress;
}

export async function markHomeworkRejected(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  note?: string,
): Promise<CourseLessonStudentProgress> {
  const progress = await loadProgress(admin, telegramId, sanityLessonId);
  if (!progress || progress.homework_status !== 'submitted') {
    throw new CourseHomeworkError('Нет домашки на проверке.', 'NOT_SUBMITTED');
  }

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const { data, error } = await admin
    .from('course_lesson_student_progress')
    .update({
      homework_status: 'rejected',
      review_note: note?.trim() || null,
      updated_at: now,
    })
    .eq('telegram_id', telegramId)
    .eq('sanity_lesson_id', sanityLessonId)
    .select('*')
    .single();
  if (error) throw error;

  const resumed = await resumeDeadlineOnReject(admin, telegramId, sanityLessonId, nowDate);
  if (resumed.immediatelyOverdue) {
    const { notifyCuratorOverdueOnce } = await import('./homework-deadline-notify');
    void notifyCuratorOverdueOnce(admin, telegramId, sanityLessonId).catch((err) =>
      console.error('[courseHomework] overdue notify on reject failed:', err),
    );
  }

  return (resumed.progress as CourseLessonStudentProgress | null) ?? (data as CourseLessonStudentProgress);
}

export async function approveCourseHomeworkByCurator(
  admin: SupabaseClient,
  curatorTelegramId: number,
  studentTelegramId: number,
  lessonNumber: number,
): Promise<{ lesson: CourseLessonContent; progress: CourseLessonStudentProgress }> {
  const content = await getDistrictCourseContent();
  if (!content) throw new CourseHomeworkError('Курс не найден.', 'LESSON_NOT_FOUND');
  const lesson = findLessonByNumber(content, lessonNumber);
  if (!lesson) throw new CourseHomeworkError(`Занятие №${lessonNumber} не найдено.`, 'LESSON_NOT_FOUND');

  await assertCuratorAssigned(admin, curatorTelegramId, studentTelegramId);
  const progress = await loadProgress(admin, studentTelegramId, lesson.sanityId);
  if (!progress || progress.homework_status !== 'submitted') {
    throw new CourseHomeworkError('Нет домашки на проверке.', 'NOT_SUBMITTED');
  }

  const updated = await markHomeworkApproved(
    admin,
    studentTelegramId,
    { sanityLessonId: lesson.sanityId },
    undefined,
    {
      materialKeys: collectLessonMaterialKeys(lesson),
      hasHomework: lessonHasHomework(lesson),
    },
  );
  await finalizeDeadlineOnApprove(admin, studentTelegramId, lesson.sanityId);

  try {
    const courseId = await resolveCourseIdForContent(admin, content);
    if (courseId) {
      await unlockNextCourseLessonAfterCleared(admin, studentTelegramId, courseId, content);
    }
  } catch (error) {
    console.error('[courseHomework] unlock next after approve failed:', error);
  }

  return { lesson, progress: updated };
}

export type HomeworkLifeDeductionResult = {
  deducted: boolean;
  livesCurrent: number;
  livesMax: number;
  accessBlocked: boolean;
};

export async function rejectCourseHomeworkByCurator(
  admin: SupabaseClient,
  curatorTelegramId: number,
  studentTelegramId: number,
  lessonNumber: number,
  note?: string,
): Promise<{
  lesson: CourseLessonContent;
  progress: CourseLessonStudentProgress;
  lifeDeduction: HomeworkLifeDeductionResult | null;
}> {
  const content = await getDistrictCourseContent();
  if (!content) throw new CourseHomeworkError('Курс не найден.', 'LESSON_NOT_FOUND');
  const lesson = findLessonByNumber(content, lessonNumber);
  if (!lesson) throw new CourseHomeworkError(`Занятие №${lessonNumber} не найдено.`, 'LESSON_NOT_FOUND');

  await assertCuratorAssigned(admin, curatorTelegramId, studentTelegramId);
  // Reject только возобновляет таймер; жизнь за просрочку — вручную.
  const updated = await markHomeworkRejected(admin, studentTelegramId, lesson.sanityId, note);
  return { lesson, progress: updated, lifeDeduction: null };
}

export async function deductLifeForHomeworkDebtByCurator(
  admin: SupabaseClient,
  curatorTelegramId: number,
  studentTelegramId: number,
  sanityLessonId: string,
  failureKind: Extract<HomeworkLifeFailureKind, 'notSubmitted' | 'notCompleted' | 'overdue'> = 'overdue',
): Promise<{ lifeDeduction: HomeworkLifeDeductionResult | null }> {
  await assertCuratorAssigned(admin, curatorTelegramId, studentTelegramId);
  const lifeDeduction = await tryDeductLifeForHomework(
    admin,
    curatorTelegramId,
    studentTelegramId,
    sanityLessonId,
    failureKind,
  );
  return { lifeDeduction };
}

async function tryDeductLifeForHomework(
  admin: SupabaseClient,
  curatorTelegramId: number,
  studentTelegramId: number,
  sanityLessonId: string,
  failureKind: HomeworkLifeFailureKind,
): Promise<HomeworkLifeDeductionResult | null> {
  const content = await getDistrictCourseContent();
  if (!content) return null;
  const courseId = await resolveCourseIdForContent(admin, content);
  if (!courseId) return null;

  try {
    const { state, deducted } = await deductLifeForHomeworkFailure(admin, {
      telegramId: studentTelegramId,
      courseId,
      curatorTelegramId,
      sanityLessonId,
      failureKind,
    });
    return {
      deducted,
      livesCurrent: state.lives_current,
      livesMax: state.lives_max,
      accessBlocked: state.access_blocked,
    };
  } catch (error) {
    if (isLivesTableError(error)) return null;
    throw error;
  }
}

export { formatLifeDeductionNote };

export function mapProgressToCuratorStatus(
  lesson: CourseLessonContent,
  progress: CourseLessonStudentProgress | undefined,
  hasAccess: boolean,
  sessionStatus?: SanityWebinarSessionStatus,
): HomeworkProgressStatus | 'waiting' | 'upcoming' {
  if (!hasAccess) return 'upcoming';
  const status = progress?.homework_status ?? 'pending';
  if (status === 'approved') return 'approved';
  if (status === 'submitted') return 'submitted';
  if (status === 'rejected') return 'rejected';
  if (lessonReadyForSubmit(lesson, progress, sessionStatus)) return 'pending';
  return 'upcoming';
}

export const HOMEWORK_STATUS_LABELS: Record<HomeworkProgressStatus, { state: string; tone: 'ok' | 'now' }> = {
  pending: { state: 'Не сдано', tone: 'now' },
  submitted: { state: 'На проверке', tone: 'now' },
  approved: { state: 'Принято', tone: 'ok' },
  rejected: { state: 'На доработке', tone: 'now' },
};
