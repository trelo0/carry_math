import type { SupabaseClient } from '@supabase/supabase-js';
import {
  addTeacherBlockedDate,
  clearTeacherDay,
  loadTeacherWorkingHours,
  setTeacherDayOverride,
  type TeacherWorkingHoursData,
} from '@/lib/teacher/working-hours';
import { ScheduleValidationError, validateLessonSlot } from '@/lib/teacher/schedule-validation';
import { rpcTeacherApplyDaySchedule } from '@/lib/teacher/schedule-rpc';

export type DayMoveInput = { lessonId: number; startsAt: string; durationMinutes: number };

export type ApplyDayInput = {
  date: string;
  mode: 'work' | 'off';
  startTime?: string;
  endTime?: string;
  note?: string | null;
  moves: DayMoveInput[];
};

/** Проверяет все переносы, затем применяет их и изменение дня; при ошибке на шаге 2 откатывает переносы. */
export async function applyDayWithMoves(
  admin: SupabaseClient,
  teacherTelegramId: number,
  input: ApplyDayInput,
): Promise<TeacherWorkingHoursData> {
  const moves = input.moves ?? [];
  const originalStarts = new Map<number, { startsAt: string; durationMinutes: number }>();

  for (const move of moves) {
    const { data: lesson } = await admin
      .from('scheduled_lessons')
      .select('id, teacher_telegram_id, status, starts_at, duration_minutes')
      .eq('id', move.lessonId)
      .maybeSingle();
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
    await validateLessonSlot(admin, teacherTelegramId, {
      startsAt: move.startsAt,
      durationMinutes: move.durationMinutes,
      excludeLessonId: move.lessonId,
    });
  }

  const rpc = await rpcTeacherApplyDaySchedule(admin, teacherTelegramId, input);
  if (rpc.ok) {
    return loadTeacherWorkingHours(admin, teacherTelegramId);
  }

  const applied: number[] = [];
  try {
    for (const move of moves) {
      const { error } = await admin
        .from('scheduled_lessons')
        .update({
          starts_at: move.startsAt,
          duration_minutes: move.durationMinutes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', move.lessonId)
        .eq('teacher_telegram_id', teacherTelegramId)
        .eq('status', 'scheduled');
      if (error) throw new ScheduleValidationError(error.message);
      applied.push(move.lessonId);
    }

    if (input.mode === 'off') {
      await addTeacherBlockedDate(admin, teacherTelegramId, input.date, input.note?.trim() || null);
    } else if (input.startTime && input.endTime) {
      await setTeacherDayOverride(admin, teacherTelegramId, input.date, input.startTime, input.endTime);
    }
  } catch (error) {
    for (const lessonId of applied) {
      const orig = originalStarts.get(lessonId);
      if (!orig) continue;
      await admin
        .from('scheduled_lessons')
        .update({
          starts_at: orig.startsAt,
          duration_minutes: orig.durationMinutes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', lessonId);
    }
    throw error;
  }

  return loadTeacherWorkingHours(admin, teacherTelegramId);
}

export async function clearDayOverrideOnly(
  admin: SupabaseClient,
  teacherTelegramId: number,
  date: string,
): Promise<TeacherWorkingHoursData> {
  await clearTeacherDay(admin, teacherTelegramId, date);
  return loadTeacherWorkingHours(admin, teacherTelegramId);
}
