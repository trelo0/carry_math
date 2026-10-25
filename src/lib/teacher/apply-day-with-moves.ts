import type { SupabaseClient } from '@supabase/supabase-js';
import {
  addTeacherBlockedDate,
  clearTeacherDay,
  loadTeacherWorkingHours,
  setTeacherDayOverride,
  type TeacherWorkingHoursData,
} from '@/lib/teacher/working-hours';
import { validateLessonSlot } from '@/lib/teacher/schedule-validation';
import { rpcTeacherApplyDaySchedule } from '@/lib/teacher/schedule-rpc';
import {
  assertTeacherOwnsLessonMoves,
  restoreTeacherOwnedScheduledLessonSlot,
  updateTeacherOwnedScheduledLessonSlot,
} from '@/lib/teacher/lesson-ownership';

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
  const originalStarts = await assertTeacherOwnsLessonMoves(admin, teacherTelegramId, moves);
  for (const move of moves) {
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
      await updateTeacherOwnedScheduledLessonSlot(admin, teacherTelegramId, move);
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
      await restoreTeacherOwnedScheduledLessonSlot(
        admin,
        teacherTelegramId,
        lessonId,
        orig.startsAt,
        orig.durationMinutes,
      );
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
