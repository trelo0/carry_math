import type { SupabaseClient } from '@supabase/supabase-js';
import { ScheduleValidationError } from '@/lib/teacher/schedule-validation';

export class TeacherLessonAccessError extends Error {
  constructor(message = 'Lesson not found') {
    super(message);
    this.name = 'TeacherLessonAccessError';
  }
}

/** Занятие должно принадлежать преподавателю из сессии (не доверять id из клиента). */
export async function assertTeacherOwnsScheduledLesson(
  admin: SupabaseClient,
  teacherTelegramId: number,
  lessonId: number,
): Promise<void> {
  const { data, error } = await admin
    .from('scheduled_lessons')
    .select('id')
    .eq('id', lessonId)
    .eq('teacher_telegram_id', teacherTelegramId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new TeacherLessonAccessError();
}

export async function loadTeacherOwnedLesson<
  T extends string,
>(
  admin: SupabaseClient,
  teacherTelegramId: number,
  lessonId: number,
  columns: T,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin
    .from('scheduled_lessons')
    .select(columns)
    .eq('id', lessonId)
    .eq('teacher_telegram_id', teacherTelegramId)
    .maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

export async function assertTeacherOwnsScheduleStudent(
  admin: SupabaseClient,
  teacherTelegramId: number,
  scheduleStudentId: number,
  options?: { allowArchived?: boolean },
): Promise<void> {
  let query = admin
    .from('schedule_students')
    .select('id')
    .eq('id', scheduleStudentId)
    .eq('teacher_telegram_id', teacherTelegramId);
  if (!options?.allowArchived) {
    query = query.is('archived_at', null);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new ScheduleValidationError('Ученик не найден');
}

export type LessonMoveInput = {
  lessonId: number;
  startsAt: string;
  durationMinutes: number;
};

/** Каждый перенос — только своё запланированное занятие. */
export async function assertTeacherOwnsLessonMoves(
  admin: SupabaseClient,
  teacherTelegramId: number,
  moves: LessonMoveInput[],
): Promise<Map<number, { startsAt: string; durationMinutes: number }>> {
  const originalStarts = new Map<number, { startsAt: string; durationMinutes: number }>();
  for (const move of moves) {
    const { data: lesson, error } = await admin
      .from('scheduled_lessons')
      .select('id, teacher_telegram_id, status, starts_at, duration_minutes')
      .eq('id', move.lessonId)
      .maybeSingle();
    if (error) throw error;
    if (!lesson || lesson.teacher_telegram_id !== teacherTelegramId) {
      throw new ScheduleValidationError('Занятие не найдено');
    }
    if (lesson.status !== 'scheduled') {
      throw new ScheduleValidationError('Перенести можно только запланированное занятие');
    }
    originalStarts.set(move.lessonId, {
      startsAt: lesson.starts_at as string,
      durationMinutes: (lesson.duration_minutes as number) ?? move.durationMinutes,
    });
  }
  return originalStarts;
}

export async function updateTeacherOwnedScheduledLessonSlot(
  admin: SupabaseClient,
  teacherTelegramId: number,
  move: LessonMoveInput,
): Promise<void> {
  const { data, error } = await admin
    .from('scheduled_lessons')
    .update({
      starts_at: move.startsAt,
      duration_minutes: move.durationMinutes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', move.lessonId)
    .eq('teacher_telegram_id', teacherTelegramId)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ScheduleValidationError('Занятие не найдено');
}

export async function restoreTeacherOwnedScheduledLessonSlot(
  admin: SupabaseClient,
  teacherTelegramId: number,
  lessonId: number,
  startsAt: string,
  durationMinutes: number,
): Promise<void> {
  await admin
    .from('scheduled_lessons')
    .update({
      starts_at: startsAt,
      duration_minutes: durationMinutes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', lessonId)
    .eq('teacher_telegram_id', teacherTelegramId);
}
