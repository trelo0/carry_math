import type { SupabaseClient } from '@supabase/supabase-js';
import { studentHasCourseProductAccess } from './course-access';
import {
  flattenCourseLessons,
  getDistrictCourseContent,
  type CourseLessonContent,
} from '@/lib/studio/courseContent';
import { lessonHasHomework } from './lesson-progress-calc';
import type { CourseLessonStudentProgress, HomeworkProgressStatus } from './course-progress';

/** Режим с проверкой ДЗ (режимы 1–2). Режим 3 пока не включаем. */
export type LearningMode = 'checked_homework' | 'self_paced_no_hw_check';

export const DEFAULT_LEARNING_MODE: LearningMode = 'checked_homework';

export const HOMEWORK_DEADLINE_MS = 72 * 60 * 60 * 1000;
export const DEADLINE_SOON_MS = 12 * 60 * 60 * 1000;

export type DeadlineUiPhase =
  | 'ok'
  | 'soon'
  | 'overdue'
  | 'waiting_review'
  | 'revision'
  | 'approved'
  | 'none';

export type HomeworkDeadlineFields = {
  lesson_first_opened_at: string | null;
  homework_deadline_at: string | null;
  homework_remaining_ms: number | null;
  homework_overdue_at: string | null;
  hw_remind_12h_at: string | null;
  hw_remind_6h_at: string | null;
  hw_remind_2h_at: string | null;
  hw_overdue_student_at: string | null;
  hw_overdue_curator_at: string | null;
};

const DEADLINE_SELECT =
  'id, telegram_id, sanity_lesson_id, homework_status, lesson_first_opened_at, homework_deadline_at, homework_remaining_ms, homework_overdue_at, hw_remind_12h_at, hw_remind_6h_at, hw_remind_2h_at, hw_overdue_student_at, hw_overdue_curator_at, updated_at';

function isMissingColumnError(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null)?.message ?? error);
  return (
    message.includes('lesson_first_opened_at') ||
    message.includes('homework_deadline_at') ||
    message.includes('homework_remaining_ms') ||
    message.includes('Could not find') ||
    message.includes('does not exist')
  );
}

export function deadlineUiState(
  progress: Pick<
    CourseLessonStudentProgress,
    'homework_status' | 'homework_deadline_at' | 'homework_remaining_ms' | 'homework_overdue_at'
  > | null
    | undefined,
  now = new Date(),
): DeadlineUiPhase {
  if (!progress) return 'none';
  const status = progress.homework_status;
  if (status === 'approved') return 'approved';
  if (status === 'submitted') return 'waiting_review';
  if (status === 'rejected') {
    if (progress.homework_overdue_at) return 'overdue';
    const deadline = progress.homework_deadline_at ? Date.parse(progress.homework_deadline_at) : NaN;
    if (Number.isFinite(deadline)) {
      const left = deadline - now.getTime();
      if (left <= 0) return 'overdue';
      if (left <= DEADLINE_SOON_MS) return 'soon';
      return 'revision';
    }
    return 'revision';
  }
  // pending
  if (!progress.homework_deadline_at) return 'none';
  if (progress.homework_overdue_at) return 'overdue';
  const deadline = Date.parse(progress.homework_deadline_at);
  if (!Number.isFinite(deadline)) return 'none';
  const left = deadline - now.getTime();
  if (left <= 0) return 'overdue';
  if (left <= DEADLINE_SOON_MS) return 'soon';
  return 'ok';
}

async function loadDeadlineRow(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
): Promise<(CourseLessonStudentProgress & HomeworkDeadlineFields) | null> {
  const { data, error } = await admin
    .from('course_lesson_student_progress')
    .select(DEADLINE_SELECT)
    .eq('telegram_id', telegramId)
    .eq('sanity_lesson_id', sanityLessonId)
    .maybeSingle();
  if (error) {
    if (isMissingColumnError(error)) return null;
    throw error;
  }
  return (data as (CourseLessonStudentProgress & HomeworkDeadlineFields) | null) ?? null;
}

async function resolveLesson(
  sanityLessonId: string,
): Promise<CourseLessonContent | null> {
  const content = await getDistrictCourseContent().catch(() => null);
  if (!content) return null;
  return flattenCourseLessons(content).find((l) => l.sanityId === sanityLessonId) ?? null;
}

/**
 * Старт таймера 72ч при первом открытии занятия с ДЗ.
 * Идемпотентно: повторные вызовы не меняют deadline.
 */
export async function ensureHomeworkDeadlineStarted(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  options?: { hasAccess?: boolean; learningMode?: LearningMode },
): Promise<(CourseLessonStudentProgress & HomeworkDeadlineFields) | null> {
  const mode = options?.learningMode ?? DEFAULT_LEARNING_MODE;
  if (mode === 'self_paced_no_hw_check') return null;

  const lesson = await resolveLesson(sanityLessonId);
  if (!lesson || !lessonHasHomework(lesson)) return null;
  if (options?.hasAccess === false) return null;

  const hasCourseProduct = await studentHasCourseProductAccess(admin, telegramId);
  if (lesson.isTrialFree && !hasCourseProduct) return null;

  const existing = await loadDeadlineRow(admin, telegramId, sanityLessonId);
  if (existing?.homework_deadline_at || existing?.lesson_first_opened_at) {
    return existing;
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const deadlineIso = new Date(now.getTime() + HOMEWORK_DEADLINE_MS).toISOString();

  // Атомарно: только если deadline ещё null
  if (existing) {
    const { data, error } = await admin
      .from('course_lesson_student_progress')
      .update({
        lesson_first_opened_at: nowIso,
        homework_deadline_at: deadlineIso,
        updated_at: nowIso,
      })
      .eq('telegram_id', telegramId)
      .eq('sanity_lesson_id', sanityLessonId)
      .is('homework_deadline_at', null)
      .select(DEADLINE_SELECT)
      .maybeSingle();
    if (error) {
      if (isMissingColumnError(error)) return existing;
      throw error;
    }
    if (data) return data as CourseLessonStudentProgress & HomeworkDeadlineFields;
    return loadDeadlineRow(admin, telegramId, sanityLessonId);
  }

  const { data, error } = await admin
    .from('course_lesson_student_progress')
    .insert({
      telegram_id: telegramId,
      sanity_lesson_id: sanityLessonId,
      homework_status: 'pending',
      lesson_first_opened_at: nowIso,
      homework_deadline_at: deadlineIso,
      updated_at: nowIso,
    })
    .select(DEADLINE_SELECT)
    .maybeSingle();

  if (error) {
    if (isMissingColumnError(error)) return null;
    // Гонка insert — перечитать; если deadline ещё null — дописать атомарно
    const again = await loadDeadlineRow(admin, telegramId, sanityLessonId);
    if (again?.homework_deadline_at) return again;
    if (again) {
      const { data: patched, error: patchError } = await admin
        .from('course_lesson_student_progress')
        .update({
          lesson_first_opened_at: again.lesson_first_opened_at ?? nowIso,
          homework_deadline_at: deadlineIso,
          updated_at: nowIso,
        })
        .eq('telegram_id', telegramId)
        .eq('sanity_lesson_id', sanityLessonId)
        .is('homework_deadline_at', null)
        .select(DEADLINE_SELECT)
        .maybeSingle();
      if (patchError && !isMissingColumnError(patchError)) throw patchError;
      if (patched) return patched as CourseLessonStudentProgress & HomeworkDeadlineFields;
      return loadDeadlineRow(admin, telegramId, sanityLessonId);
    }
    throw error;
  }

  return (data as (CourseLessonStudentProgress & HomeworkDeadlineFields) | null) ?? null;
}

/** Пауза таймера при отправке ДЗ. */
export async function pauseDeadlineOnSubmit(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  now = new Date(),
): Promise<{ remainingMs: number; wasOverdue: boolean }> {
  const row = await loadDeadlineRow(admin, telegramId, sanityLessonId);
  const deadlineMs = row?.homework_deadline_at ? Date.parse(row.homework_deadline_at) : NaN;
  let remainingMs = 0;
  if (Number.isFinite(deadlineMs)) {
    remainingMs = Math.max(0, deadlineMs - now.getTime());
  } else if (typeof row?.homework_remaining_ms === 'number') {
    remainingMs = Math.max(0, row.homework_remaining_ms);
  }

  const wasOverdue = remainingMs <= 0 || Boolean(row?.homework_overdue_at);
  const patch: Record<string, unknown> = {
    homework_remaining_ms: remainingMs,
    // На проверке дедлайн «заморожен» — оставляем абсолютный для истории, но cron смотрит status
    updated_at: now.toISOString(),
  };
  if (wasOverdue && !row?.homework_overdue_at) {
    patch.homework_overdue_at = now.toISOString();
  }

  const { error } = await admin
    .from('course_lesson_student_progress')
    .update(patch)
    .eq('telegram_id', telegramId)
    .eq('sanity_lesson_id', sanityLessonId);
  if (error && !isMissingColumnError(error)) throw error;

  return { remainingMs, wasOverdue };
}

/** Возобновление с остатка после reject. */
export async function resumeDeadlineOnReject(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  now = new Date(),
): Promise<{
  progress: (CourseLessonStudentProgress & HomeworkDeadlineFields) | null;
  remainingMs: number;
  immediatelyOverdue: boolean;
}> {
  const row = await loadDeadlineRow(admin, telegramId, sanityLessonId);
  const remainingMs = Math.max(0, Number(row?.homework_remaining_ms ?? 0));
  const immediatelyOverdue = remainingMs <= 0;
  const nowIso = now.toISOString();
  const newDeadline = immediatelyOverdue
    ? nowIso
    : new Date(now.getTime() + remainingMs).toISOString();

  const patch: Record<string, unknown> = {
    homework_deadline_at: newDeadline,
    homework_remaining_ms: remainingMs,
    updated_at: nowIso,
  };
  if (immediatelyOverdue && !row?.homework_overdue_at) {
    patch.homework_overdue_at = nowIso;
  }

  const { data, error } = await admin
    .from('course_lesson_student_progress')
    .update(patch)
    .eq('telegram_id', telegramId)
    .eq('sanity_lesson_id', sanityLessonId)
    .select(DEADLINE_SELECT)
    .maybeSingle();
  if (error) {
    if (isMissingColumnError(error)) {
      return { progress: row, remainingMs, immediatelyOverdue };
    }
    throw error;
  }

  return {
    progress: (data as (CourseLessonStudentProgress & HomeworkDeadlineFields) | null) ?? row,
    remainingMs,
    immediatelyOverdue,
  };
}

/** Окончательная остановка после approve. */
export async function finalizeDeadlineOnApprove(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from('course_lesson_student_progress')
    .update({
      homework_remaining_ms: 0,
      updated_at: now,
    })
    .eq('telegram_id', telegramId)
    .eq('sanity_lesson_id', sanityLessonId);
  if (error && !isMissingColumnError(error)) throw error;
}

export function markOverdueIfNeeded(
  deadlineAt: string | null | undefined,
  overdueAt: string | null | undefined,
  now = new Date(),
): string | null {
  if (overdueAt) return overdueAt;
  if (!deadlineAt) return null;
  const t = Date.parse(deadlineAt);
  if (!Number.isFinite(t) || t > now.getTime()) return null;
  return now.toISOString();
}

export type ActiveDeadlineRow = CourseLessonStudentProgress & HomeworkDeadlineFields & {
  homework_status: HomeworkProgressStatus;
};

/** Строки с активным таймером (для cron или ленивой проверки). */
export async function listActiveHomeworkDeadlines(
  admin: SupabaseClient,
  limit = 200,
  options?: { telegramIds?: number[] },
): Promise<ActiveDeadlineRow[]> {
  let query = admin
    .from('course_lesson_student_progress')
    .select(DEADLINE_SELECT)
    .in('homework_status', ['pending', 'rejected'])
    .not('homework_deadline_at', 'is', null)
    .order('homework_deadline_at', { ascending: true })
    .limit(limit);
  if (options?.telegramIds?.length) {
    query = query.in('telegram_id', options.telegramIds);
  }
  const { data, error } = await query;
  if (error) {
    if (isMissingColumnError(error)) return [];
    throw error;
  }
  return (data ?? []) as ActiveDeadlineRow[];
}

export async function claimDeadlineReminder(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  column:
    | 'hw_remind_12h_at'
    | 'hw_remind_6h_at'
    | 'hw_remind_2h_at'
    | 'hw_overdue_student_at'
    | 'hw_overdue_curator_at',
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('course_lesson_student_progress')
    .update({ [column]: now, updated_at: now })
    .eq('telegram_id', telegramId)
    .eq('sanity_lesson_id', sanityLessonId)
    .is(column, null)
    .select('id')
    .maybeSingle();
  if (error) {
    if (isMissingColumnError(error)) return false;
    throw error;
  }
  return Boolean(data);
}

export async function ensureOverdueMarked(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  now = new Date(),
): Promise<boolean> {
  const row = await loadDeadlineRow(admin, telegramId, sanityLessonId);
  if (!row?.homework_deadline_at) return false;
  if (row.homework_overdue_at) return true;
  const deadline = Date.parse(row.homework_deadline_at);
  if (!Number.isFinite(deadline) || deadline > now.getTime()) return false;

  const { data, error } = await admin
    .from('course_lesson_student_progress')
    .update({ homework_overdue_at: now.toISOString(), updated_at: now.toISOString() })
    .eq('telegram_id', telegramId)
    .eq('sanity_lesson_id', sanityLessonId)
    .is('homework_overdue_at', null)
    .select('id')
    .maybeSingle();
  if (error) {
    if (isMissingColumnError(error)) return false;
    throw error;
  }
  return Boolean(data) || Boolean(row.homework_overdue_at);
}

/**
 * После первой оплаты курса: на пробном занятии таймер ДЗ снова 72 ч (если ДЗ ещё не принято).
 */
export async function resetTrialHomeworkDeadlineOnCoursePurchase(
  admin: SupabaseClient,
  telegramId: number,
  courseSlug?: string | null,
): Promise<void> {
  const content = await getDistrictCourseContent(courseSlug || undefined).catch(() => null);
  if (!content) return;
  const trial = flattenCourseLessons(content).find((l) => l.isTrialFree);
  if (!trial?.sanityId) return;

  const row = await loadDeadlineRow(admin, telegramId, trial.sanityId);
  if (row?.homework_status === 'approved') return;

  const now = new Date();
  const nowIso = now.toISOString();
  const deadlineIso = new Date(now.getTime() + HOMEWORK_DEADLINE_MS).toISOString();
  const patch = {
    lesson_first_opened_at: row?.lesson_first_opened_at ?? nowIso,
    homework_deadline_at: deadlineIso,
    homework_remaining_ms: HOMEWORK_DEADLINE_MS,
    homework_overdue_at: null,
    hw_remind_12h_at: null,
    hw_remind_6h_at: null,
    hw_remind_2h_at: null,
    hw_overdue_student_at: null,
    hw_overdue_curator_at: null,
    updated_at: nowIso,
  };

  if (row) {
    const { error } = await admin
      .from('course_lesson_student_progress')
      .update(patch)
      .eq('telegram_id', telegramId)
      .eq('sanity_lesson_id', trial.sanityId);
    if (error && !isMissingColumnError(error)) throw error;
    return;
  }

  const { error: insertError } = await admin.from('course_lesson_student_progress').insert({
    telegram_id: telegramId,
    sanity_lesson_id: trial.sanityId,
    homework_status: 'pending',
    ...patch,
  });
  if (insertError && !isMissingColumnError(insertError)) throw insertError;
}
