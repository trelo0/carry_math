import type { SupabaseClient } from '@supabase/supabase-js';
import { blockLessonsForZeroLives, unblockLessonsAfterLivesRestore } from './course-access';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';

export type CourseEnrollmentState = {
  telegram_id: number;
  course_id: number;
  lives_current: number;
  lives_max: number;
  access_blocked: boolean;
  updated_at: string;
};

export type CourseLifeEvent = {
  id: number;
  telegram_id: number;
  course_id: number;
  delta: -1 | 1;
  reason: string;
  curator_telegram_id: number | null;
  course_lesson_id: number | null;
  sanity_lesson_id: string | null;
  created_at: string;
};

export const HOMEWORK_LIFE_REASONS = {
  notSubmitted: 'ДЗ не сдано',
  notCompleted: 'ДЗ не выполнено',
  rejected: 'ДЗ выполнено неправильно',
} as const;

export type HomeworkLifeFailureKind = keyof typeof HOMEWORK_LIFE_REASONS;

export function isLivesTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return (
    message.includes('course_enrollment_state') ||
    message.includes('course_life_events') ||
    message.includes('does not exist') ||
    message.includes('Could not find')
  );
}

export async function initEnrollmentLives(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  livesMax = 3,
): Promise<CourseEnrollmentState> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('course_enrollment_state')
    .upsert(
      {
        telegram_id: telegramId,
        course_id: courseId,
        lives_current: livesMax,
        lives_max: livesMax,
        access_blocked: false,
        updated_at: now,
      },
      { onConflict: 'telegram_id,course_id' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return data as CourseEnrollmentState;
}

export async function getEnrollmentLives(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
): Promise<CourseEnrollmentState | null> {
  const { data, error } = await admin
    .from('course_enrollment_state')
    .select('*')
    .eq('telegram_id', telegramId)
    .eq('course_id', courseId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as CourseEnrollmentState) : null;
}

export async function hasLifeDeductedForLesson(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  sanityLessonId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('course_life_events')
    .select('id')
    .eq('telegram_id', telegramId)
    .eq('course_id', courseId)
    .eq('sanity_lesson_id', sanityLessonId)
    .eq('delta', -1)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/** Списание жизни за провал по домашке (не сдал / не выполнил / неправильно). Идемпотентно по sanity_lesson_id. */
export async function deductLifeForHomeworkFailure(
  admin: SupabaseClient,
  params: {
    telegramId: number;
    courseId: number;
    curatorTelegramId: number;
    sanityLessonId: string;
    courseLessonId?: number;
    failureKind: HomeworkLifeFailureKind;
  },
): Promise<{ state: CourseEnrollmentState; deducted: boolean }> {
  const state = await getEnrollmentLives(admin, params.telegramId, params.courseId);
  if (!state) {
    throw new Error('Ученик не зачислен на курс или жизни не инициализированы.');
  }

  const already = await hasLifeDeductedForLesson(
    admin,
    params.telegramId,
    params.courseId,
    params.sanityLessonId,
  );
  if (already) return { state, deducted: false };
  if (state.lives_current <= 0) return { state, deducted: false };

  const now = new Date().toISOString();
  const newLives = state.lives_current - 1;
  const accessBlocked = newLives <= 0;
  const reason = HOMEWORK_LIFE_REASONS[params.failureKind];

  const { error: eventError } = await admin.from('course_life_events').insert({
    telegram_id: params.telegramId,
    course_id: params.courseId,
    delta: -1,
    reason,
    curator_telegram_id: params.curatorTelegramId,
    course_lesson_id: params.courseLessonId ?? null,
    sanity_lesson_id: params.sanityLessonId,
  });
  if (eventError) throw eventError;

  const { data, error } = await admin
    .from('course_enrollment_state')
    .update({
      lives_current: newLives,
      access_blocked: accessBlocked,
      updated_at: now,
    })
    .eq('telegram_id', params.telegramId)
    .eq('course_id', params.courseId)
    .select('*')
    .single();
  if (error) throw error;

  if (accessBlocked) {
    const content = await getDistrictCourseContent().catch(() => null);
    await blockLessonsForZeroLives(admin, params.telegramId, params.courseId, content);
  }

  return { state: data as CourseEnrollmentState, deducted: true };
}

/** Куратор снимает жизнь за невыполненное обязательное ДЗ. */
export async function deductLifeForMissingHomework(
  admin: SupabaseClient,
  params: {
    telegramId: number;
    courseId: number;
    curatorTelegramId: number;
    sanityLessonId: string;
    courseLessonId?: number;
    failureKind?: HomeworkLifeFailureKind;
    reason?: string;
  },
): Promise<CourseEnrollmentState> {
  const { state } = await deductLifeForHomeworkFailure(admin, {
    telegramId: params.telegramId,
    courseId: params.courseId,
    curatorTelegramId: params.curatorTelegramId,
    sanityLessonId: params.sanityLessonId,
    courseLessonId: params.courseLessonId,
    failureKind: params.failureKind ?? 'notSubmitted',
  });
  return state;
}

/** Бонус: +1 жизнь. */
export async function grantBonusLife(
  admin: SupabaseClient,
  params: {
    telegramId: number;
    courseId: number;
    curatorTelegramId: number;
    reason: string;
  },
): Promise<CourseEnrollmentState> {
  const state = await getEnrollmentLives(admin, params.telegramId, params.courseId);
  if (!state) {
    throw new Error('Ученик не зачислен на курс.');
  }

  const now = new Date().toISOString();
  const newLives = Math.min(state.lives_max, state.lives_current + 1);
  const wasBlocked = state.access_blocked;

  const { error: eventError } = await admin.from('course_life_events').insert({
    telegram_id: params.telegramId,
    course_id: params.courseId,
    delta: 1,
    reason: params.reason,
    curator_telegram_id: params.curatorTelegramId,
    course_lesson_id: null,
    sanity_lesson_id: null,
  });
  if (eventError) throw eventError;

  const { data, error } = await admin
    .from('course_enrollment_state')
    .update({
      lives_current: newLives,
      access_blocked: false,
      updated_at: now,
    })
    .eq('telegram_id', params.telegramId)
    .eq('course_id', params.courseId)
    .select('*')
    .single();
  if (error) throw error;

  if (wasBlocked) {
    const content = await getDistrictCourseContent().catch(() => null);
    await unblockLessonsAfterLivesRestore(admin, params.telegramId, params.courseId, content);
  }

  return data as CourseEnrollmentState;
}

export async function getLifeEvents(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  limit = 20,
): Promise<CourseLifeEvent[]> {
  const { data, error } = await admin
    .from('course_life_events')
    .select('*')
    .eq('telegram_id', telegramId)
    .eq('course_id', courseId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as CourseLifeEvent[];
}

export function formatLifeDeductionNote(
  lifeDeduction: { deducted: boolean; livesCurrent: number; livesMax: number; accessBlocked: boolean } | null,
): string {
  if (!lifeDeduction) return '';
  if (!lifeDeduction.deducted) {
    return `\n\n❤️ Жизнь за это ДЗ уже была снята. Осталось: ${lifeDeduction.livesCurrent} из ${lifeDeduction.livesMax}.`;
  }
  const blocked = lifeDeduction.accessBlocked ? '\n\n⚠️ Доступ к урокам заблокирован — 0 жизней.' : '';
  return `\n\n❤️ Снята 1 жизнь. Осталось: ${lifeDeduction.livesCurrent} из ${lifeDeduction.livesMax}.${blocked}`;
}
