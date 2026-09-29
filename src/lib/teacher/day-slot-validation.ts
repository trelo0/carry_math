import type { SupabaseClient } from '@supabase/supabase-js';
import { findDaySlotConflict, mapTeacherLessonToEvent } from '@/lib/teacher/schedule-utils';
import type { TeacherDaySlot } from '@/lib/teacher/cabinet-data';
import { ScheduleValidationError } from '@/lib/teacher/schedule-validation';

async function loadDaySlotsForDate(
  admin: SupabaseClient,
  teacherTelegramId: number,
  slotDate: string,
): Promise<TeacherDaySlot[]> {
  const { data } = await admin
    .from('teacher_day_slots')
    .select('id, slot_date, start_time, end_time, slot_kind, label')
    .eq('teacher_telegram_id', teacherTelegramId)
    .eq('slot_date', slotDate);
  return (data ?? []).map((row) => ({
    id: row.id as number,
    slotDate: String(row.slot_date),
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
    slotKind: (row.slot_kind as TeacherDaySlot['slotKind']) ?? 'extra',
    label: (row.label as string | null) ?? null,
  }));
}

async function loadLessonEventsForDate(
  admin: SupabaseClient,
  teacherTelegramId: number,
  slotDate: string,
) {
  const dayStart = `${slotDate}T00:00:00`;
  const dayEnd = `${slotDate}T23:59:59`;
  const { data, error } = await admin
    .from('scheduled_lessons')
    .select(
      'id, kind, starts_at, topic, status, telegram_id, group_id, meet_url, board_url, lesson_plan, cancel_reason, duration_minutes',
    )
    .eq('teacher_telegram_id', teacherTelegramId)
    .gte('starts_at', dayStart)
    .lte('starts_at', dayEnd);
  if (error) throw error;

  return (data ?? []).map((row) => {
    const startsAt = row.starts_at as string;
    const d = new Date(startsAt);
    const pad = (n: number) => String(n).padStart(2, '0');
    return mapTeacherLessonToEvent({
      id: row.id as number,
      kind: row.kind as 'individual' | 'group',
      startsAt,
      date: `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      topic: row.topic as string,
      status: row.status as 'scheduled' | 'completed' | 'cancelled' | 'no_show',
      studentTelegramId: row.telegram_id as number,
      studentName: null,
      groupId: row.group_id as number | null,
      groupTitle: null,
      meetUrl: row.meet_url as string | null,
      boardUrl: row.board_url as string | null,
      lessonPlan: row.lesson_plan as string | null,
      cancelReason: row.cancel_reason as string | null,
      durationMinutes: (row.duration_minutes as number) ?? 60,
      isUpcoming: row.status === 'scheduled' && d.getTime() > Date.now(),
    });
  });
}

export async function validateDaySlotTime(
  admin: SupabaseClient,
  teacherTelegramId: number,
  slotDate: string,
  startTime: string,
  endTime: string,
  excludeSlotId?: number,
): Promise<void> {
  if (!slotDate || !startTime || !endTime) {
    throw new ScheduleValidationError('slotDate, startTime, endTime required');
  }
  if (startTime >= endTime) {
    throw new ScheduleValidationError('Время начала должно быть раньше окончания');
  }

  const [daySlots, events] = await Promise.all([
    loadDaySlotsForDate(admin, teacherTelegramId, slotDate),
    loadLessonEventsForDate(admin, teacherTelegramId, slotDate),
  ]);

  const conflict = findDaySlotConflict(slotDate, startTime, endTime, events, daySlots, excludeSlotId);
  if (conflict) throw new ScheduleValidationError(conflict);
}

export function mapSlotRow(row: Record<string, unknown>) {
  return {
    id: row.id as number,
    slotDate: String(row.slot_date),
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
    slotKind: (row.slot_kind as TeacherDaySlot['slotKind']) ?? 'extra',
    label: (row.label as string | null) ?? null,
  };
}
