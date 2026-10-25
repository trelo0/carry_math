import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadTeacherWorkingHours,
  saveTeacherWeeklyHours,
  type TeacherWorkingHoursData,
  type WeeklySlotInput,
} from '@/lib/teacher/working-hours';
import {
  ScheduleValidationError,
  loadTeacherLessons,
  validateLessonSlot,
} from '@/lib/teacher/schedule-validation';
import { rpcTeacherApplyWeeklySchedule } from '@/lib/teacher/schedule-rpc';
import { proposedWorkingHours, lessonsConflictingWithWeekly } from '@/lib/teacher/weekly-schedule-conflicts';
import type { DayMoveInput } from './apply-day-with-moves';
import { dateKey } from '@/lib/teacher/schedule-utils';
import {
  assertTeacherOwnsLessonMoves,
  restoreTeacherOwnedScheduledLessonSlot,
  updateTeacherOwnedScheduledLessonSlot,
} from '@/lib/teacher/lesson-ownership';

export async function applyWeekWithMoves(
  admin: SupabaseClient,
  teacherTelegramId: number,
  weekly: WeeklySlotInput[],
  moves: DayMoveInput[],
): Promise<TeacherWorkingHoursData> {
  const workingHours = await loadTeacherWorkingHours(admin, teacherTelegramId);
  const minKey = dateKey(new Date());
  const from = new Date(minKey + 'T00:00:00').toISOString();
  const lessons = await loadTeacherLessons(admin, teacherTelegramId, {
    from,
    to: new Date(Date.now() + 400 * 86400000).toISOString(),
  });
  const conflicts = lessonsConflictingWithWeekly(lessons, workingHours, weekly, minKey);
  const moveIds = new Set(moves.map((move) => move.lessonId));
  const unresolved = conflicts.filter((lesson) => !moveIds.has(lesson.id));
  if (unresolved.length > 0) {
    throw new ScheduleValidationError(
      `Не разрешены конфликты с шаблоном (${unresolved.length}). Перенесите занятия или отмените изменение.`,
    );
  }

  const originalStarts = await assertTeacherOwnsLessonMoves(admin, teacherTelegramId, moves);

  const proposed = proposedWorkingHours(workingHours, weekly);
  for (const move of moves) {
    await validateLessonSlot(admin, teacherTelegramId, {
      startsAt: move.startsAt,
      durationMinutes: move.durationMinutes,
      excludeLessonId: move.lessonId,
      workingHoursOverride: proposed,
    });
  }

  const rpc = await rpcTeacherApplyWeeklySchedule(admin, teacherTelegramId, weekly, moves);
  if (rpc.ok) {
    return loadTeacherWorkingHours(admin, teacherTelegramId);
  }

  const applied: number[] = [];
  try {
    for (const move of moves) {
      await updateTeacherOwnedScheduledLessonSlot(admin, teacherTelegramId, move);
      applied.push(move.lessonId);
    }
    await saveTeacherWeeklyHours(admin, teacherTelegramId, weekly);
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
