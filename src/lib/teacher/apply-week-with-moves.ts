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

  const proposed = proposedWorkingHours(workingHours, weekly);
  for (const move of moves) {
    await validateLessonSlot(admin, teacherTelegramId, {
      startsAt: move.startsAt,
      durationMinutes: move.durationMinutes,
      excludeLessonId: move.lessonId,
      workingHoursOverride: proposed,
    });
  }

  const originalStarts = new Map<number, { startsAt: string; durationMinutes: number }>();
  for (const move of moves) {
    const lesson = lessons.find((item) => item.id === move.lessonId);
    if (lesson) {
      originalStarts.set(move.lessonId, {
        startsAt: lesson.startsAt,
        durationMinutes: lesson.durationMinutes,
      });
    }
  }

  const rpc = await rpcTeacherApplyWeeklySchedule(admin, teacherTelegramId, weekly, moves);
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
    await saveTeacherWeeklyHours(admin, teacherTelegramId, weekly);
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
