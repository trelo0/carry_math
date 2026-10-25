import type { SupabaseClient } from '@supabase/supabase-js';
import type { WeeklySlotInput } from '@/lib/teacher/working-hours';
import type { DayMoveInput } from '@/lib/teacher/apply-day-with-moves';

export function isScheduleOverlapDbError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '23P01') return true;
  const msg = (error.message ?? '').toLowerCase();
  return msg.includes('scheduled_lessons_individual_no_overlap') || msg.includes('conflicting key');
}

export function formatScheduleOverlapDbError(): string {
  return 'На это время уже назначено занятие';
}

type RpcMove = { lesson_id: number; starts_at: string; duration_minutes: number };

function toRpcMoves(moves: DayMoveInput[]): RpcMove[] {
  return moves.map((move) => ({
    lesson_id: move.lessonId,
    starts_at: move.startsAt,
    duration_minutes: move.durationMinutes,
  }));
}

export async function rpcTeacherApplyDaySchedule(
  admin: SupabaseClient,
  teacherTelegramId: number,
  input: {
    date: string;
    mode: 'work' | 'off';
    startTime?: string;
    endTime?: string;
    note?: string | null;
    moves: DayMoveInput[];
  },
): Promise<{ ok: true } | { ok: false; fallback: true; error: unknown }> {
  const { error } = await admin.rpc('teacher_apply_day_schedule', {
    p_teacher_id: teacherTelegramId,
    p_date: input.date,
    p_mode: input.mode,
    p_start: input.mode === 'work' ? input.startTime : null,
    p_end: input.mode === 'work' ? input.endTime : null,
    p_note: input.note ?? null,
    p_moves: toRpcMoves(input.moves),
  });
  if (!error) return { ok: true };
  if ((error.message ?? '').includes('Could not find the function')) {
    return { ok: false, fallback: true, error };
  }
  throw error;
}

export async function rpcTeacherApplyWeeklySchedule(
  admin: SupabaseClient,
  teacherTelegramId: number,
  weekly: WeeklySlotInput[],
  moves: DayMoveInput[],
): Promise<{ ok: true } | { ok: false; fallback: true; error: unknown }> {
  const pWeekly = weekly.map((slot) => ({
    day_of_week: slot.dayOfWeek,
    start_time: slot.startTime,
    end_time: slot.endTime,
    kind: slot.kind ?? 'both',
  }));
  const { error } = await admin.rpc('teacher_apply_weekly_schedule', {
    p_teacher_id: teacherTelegramId,
    p_weekly: pWeekly,
    p_moves: toRpcMoves(moves),
  });
  if (!error) return { ok: true };
  if ((error.message ?? '').includes('Could not find the function')) {
    return { ok: false, fallback: true, error };
  }
  throw error;
}
