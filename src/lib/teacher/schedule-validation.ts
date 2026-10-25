import type { SupabaseClient } from '@supabase/supabase-js';
import {
  dateKey,
  findScheduleConflict,
  lessonEndIso,
  timeToMinutes,
} from '@/lib/teacher/schedule-utils';
import {
  bandsContain,
  loadTeacherWorkingHours,
  resolveDayHours,
  type TeacherWorkingHoursData,
  type WeeklySlotInput,
} from '@/lib/teacher/working-hours';
import { lessonsConflictingWithWeekly } from '@/lib/teacher/weekly-schedule-conflicts';
import { wallClockFromIso, wallClockToLocalDate } from '@/lib/teacher/schedule-wall-clock';
import { mapTeacherLessonToEvent } from '@/lib/teacher/schedule-utils';
import type { TeacherLessonView } from '@/lib/teacher/cabinet-data';

export class ScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleValidationError';
  }
}

/** Занятия только текущего преподавателя — чужие teacher_telegram_id не участвуют в проверке. */
export async function loadTeacherLessons(
  admin: SupabaseClient,
  teacherTelegramId: number,
  range?: { from: string; to: string },
): Promise<TeacherLessonView[]> {
  let query = admin
    .from('scheduled_lessons')
    .select(
      'id, kind, starts_at, topic, status, telegram_id, group_id, meet_url, board_url, lesson_plan, cancel_reason, duration_minutes, teacher_telegram_id',
    )
    .eq('teacher_telegram_id', teacherTelegramId);
  if (range) query = query.gte('starts_at', range.from).lt('starts_at', range.to);
  const { data, error } = await query;
  if (error) throw error;

  return (data ?? [])
    .filter((row) => (row.teacher_telegram_id as number | null) === teacherTelegramId)
    .map((row) => {
    const startsAt = row.starts_at as string;
    const d = new Date(startsAt);
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      id: row.id as number,
      kind: (row.kind === 'trial' ? 'individual' : row.kind) as 'individual' | 'group',
      startsAt,
      date: `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      topic: row.topic as string,
      status: row.status as TeacherLessonView['status'],
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
    };
  });
}

export async function validateLessonSlot(
  admin: SupabaseClient,
  teacherTelegramId: number,
  params: {
    startsAt: string;
    durationMinutes: number;
    excludeLessonId?: number;
    fromSlotId?: number;
    workingHoursOverride?: TeacherWorkingHoursData;
  },
): Promise<void> {
  const starts = new Date(params.startsAt);
  if (Number.isNaN(starts.getTime())) {
    throw new ScheduleValidationError('Некорректная дата и время');
  }

  const endsAt = lessonEndIso(params.startsAt, params.durationMinutes);
  const startWall = wallClockFromIso(params.startsAt);
  const endWall = wallClockFromIso(endsAt);
  const startTime = startWall.time;
  const endTime = endWall.time;

  const lessons = await loadTeacherLessons(admin, teacherTelegramId);

  const events = lessons.map(mapTeacherLessonToEvent);
  const conflict = findScheduleConflict(
    events,
    params.startsAt,
    endsAt,
    params.excludeLessonId ? `lesson-${params.excludeLessonId}` : undefined,
  );
  if (conflict) {
    throw new ScheduleValidationError(
      `Конфликт с занятием «${conflict.title}» (${conflict.participantLabel})`,
    );
  }

  if (params.fromSlotId) {
    const { data: sourceSlot } = await admin
      .from('teacher_day_slots')
      .select('start_time, end_time, slot_kind')
      .eq('id', params.fromSlotId)
      .eq('teacher_telegram_id', teacherTelegramId)
      .maybeSingle();
    if (!sourceSlot || sourceSlot.slot_kind !== 'extra') {
      throw new ScheduleValidationError('Свободный слот не найден');
    }
    const slotStart = timeToMinutes(String(sourceSlot.start_time).slice(0, 5));
    const slotEnd = timeToMinutes(String(sourceSlot.end_time).slice(0, 5));
    const startMin = timeToMinutes(startTime);
    const endMin = timeToMinutes(endTime);
    if (startMin < slotStart || endMin > slotEnd) {
      throw new ScheduleValidationError('Занятие должно умещаться в выбранный слот');
    }
  }

  const dayKey = startWall.dateKey;
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  const { data: blockedRows } = await admin
    .from('teacher_day_slots')
    .select('start_time, end_time, label, slot_kind')
    .eq('teacher_telegram_id', teacherTelegramId)
    .eq('slot_date', dayKey);

  for (const row of blockedRows ?? []) {
    const kind = row.slot_kind as string | undefined;
    if (kind !== 'blocked' && kind !== 'break') continue;
    const blockStart = timeToMinutes(String(row.start_time).slice(0, 5));
    const blockEnd = timeToMinutes(String(row.end_time).slice(0, 5));
    if (startMin < blockEnd && endMin > blockStart) {
      const label = (row.label as string | null)?.trim() || 'Занято';
      throw new ScheduleValidationError(`Время пересекается с блоком «${label}»`);
    }
  }

  const workingHours =
    params.workingHoursOverride ?? (await loadTeacherWorkingHours(admin, teacherTelegramId));
  const resolved = resolveDayHours(workingHours, wallClockToLocalDate(dayKey));
  if (resolved.kind === 'off') {
    throw new ScheduleValidationError('В этот день у преподавателя выходной');
  }
  if (resolved.kind === 'work' && !bandsContain(resolved.bands, startTime, endTime)) {
    throw new ScheduleValidationError('Время вне рабочих часов преподавателя');
  }
}

/**
 * Запланированные занятия дня, не попадающие в рабочие интервалы.
 * bands = null — день выходной (все занятия считаются конфликтующими).
 */
export async function findLessonsOutsideHours(
  admin: SupabaseClient,
  teacherTelegramId: number,
  day: string,
  bands: { startTime: string; endTime: string }[] | null,
): Promise<TeacherLessonView[]> {
  // Запрашиваем только окно вокруг дня (часовые пояса сервера и клиента могут отличаться на сутки).
  const [y, m, d] = day.split('-').map(Number);
  const from = new Date(y, m - 1, d - 1).toISOString();
  const to = new Date(y, m - 1, d + 2).toISOString();
  const lessons = await loadTeacherLessons(admin, teacherTelegramId, { from, to });
  return lessons.filter((lesson) => {
    if (lesson.status !== 'scheduled') return false;
    const startWall = wallClockFromIso(lesson.startsAt);
    if (startWall.dateKey !== day) return false;
    if (bands == null) return true;
    const startTime = startWall.time;
    const endWall = wallClockFromIso(lessonEndIso(lesson.startsAt, lesson.durationMinutes));
    const endTime = endWall.time;
    if (endWall.dateKey !== day) return true;
    return !bandsContain(bands, startTime, endTime);
  });
}

export async function findLessonsConflictingWithWeekly(
  admin: SupabaseClient,
  teacherTelegramId: number,
  weekly: WeeklySlotInput[],
  minDateKey?: string,
): Promise<TeacherLessonView[]> {
  const workingHours = await loadTeacherWorkingHours(admin, teacherTelegramId);
  const minKey = minDateKey ?? dateKey(new Date());
  const from = new Date(minKey + 'T00:00:00').toISOString();
  const lessons = await loadTeacherLessons(admin, teacherTelegramId, {
    from,
    to: new Date(Date.now() + 400 * 86400000).toISOString(),
  });
  return lessonsConflictingWithWeekly(lessons, workingHours, weekly, minKey);
}



