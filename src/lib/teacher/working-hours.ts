import type { SupabaseClient } from '@supabase/supabase-js';
import type { TeacherAvailabilitySlot } from '@/lib/teacher/schedule-types';
import { availabilityBandsForDay, dateKey, timeToMinutes } from '@/lib/teacher/schedule-utils';

export type TeacherBlockedDate = {
  id: number;
  blockedDate: string;
  note: string | null;
};

/** Изменённые часы на конкретную дату (поверх недельного шаблона). */
export type TeacherDayOverride = {
  id: number;
  overrideDate: string;
  startTime: string;
  endTime: string;
};

export type TeacherWorkingHoursData = {
  weekly: TeacherAvailabilitySlot[];
  blockedDates: TeacherBlockedDate[];
  dayOverrides: TeacherDayOverride[];
};

export type WorkBand = { startTime: string; endTime: string };

export type DayHoursResolution =
  | { kind: 'unset' }
  | { kind: 'off'; note: string | null; blockedId: number | null }
  | { kind: 'work'; bands: WorkBand[]; custom: boolean };

/**
 * Эффективные часы дня: выходной → свои часы → недельный шаблон.
 * Шаблон не задан и исключений нет → 'unset' (ограничений нет).
 */
export function resolveDayHours(
  data: TeacherWorkingHoursData | undefined,
  day: Date,
): DayHoursResolution {
  if (!data) return { kind: 'unset' };
  const key = dateKey(day);
  const blocked = data.blockedDates.find((item) => item.blockedDate === key);
  if (blocked) return { kind: 'off', note: blocked.note, blockedId: blocked.id };
  const override = (data.dayOverrides ?? []).find((item) => item.overrideDate === key);
  if (override) {
    return {
      kind: 'work',
      bands: [{ startTime: override.startTime, endTime: override.endTime }],
      custom: true,
    };
  }
  if (data.weekly.length === 0) return { kind: 'unset' };
  const bands = availabilityBandsForDay(data.weekly, day).sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );
  if (bands.length === 0) return { kind: 'off', note: null, blockedId: null };
  return { kind: 'work', bands, custom: false };
}

export function bandsContain(bands: WorkBand[], startTime: string, endTime: string): boolean {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  return bands.some((band) => start >= timeToMinutes(band.startTime) && end <= timeToMinutes(band.endTime));
}

function mapWeeklyRow(row: Record<string, unknown>): TeacherAvailabilitySlot {
  return {
    id: row.id as number,
    dayOfWeek: row.day_of_week as number,
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
  };
}

export async function loadTeacherWorkingHours(
  admin: SupabaseClient,
  teacherTelegramId: number,
): Promise<TeacherWorkingHoursData> {
  const [{ data: weeklyRows }, { data: blockedRows }, { data: overrideRows }] = await Promise.all([
    admin
      .from('teacher_availability')
      .select('id, day_of_week, start_time, end_time')
      .eq('teacher_telegram_id', teacherTelegramId)
      .order('day_of_week')
      .order('start_time'),
    admin
      .from('teacher_blocked_dates')
      .select('id, blocked_date, note')
      .eq('teacher_telegram_id', teacherTelegramId)
      .order('blocked_date'),
    admin
      .from('teacher_day_overrides')
      .select('id, override_date, start_time, end_time')
      .eq('teacher_telegram_id', teacherTelegramId)
      .order('override_date'),
  ]);

  return {
    weekly: (weeklyRows ?? []).map((row) => mapWeeklyRow(row as Record<string, unknown>)),
    blockedDates: (blockedRows ?? []).map((row) => ({
      id: row.id as number,
      blockedDate: String(row.blocked_date),
      note: (row.note as string | null) ?? null,
    })),
    // Если миграция teacher_day_overrides ещё не применена, запрос вернёт ошибку и data = null.
    dayOverrides: (overrideRows ?? []).map((row) => ({
      id: row.id as number,
      overrideDate: String(row.override_date),
      startTime: String(row.start_time).slice(0, 5),
      endTime: String(row.end_time).slice(0, 5),
    })),
  };
}

export type WeeklySlotInput = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  kind?: 'individual' | 'group' | 'both';
};

export async function saveTeacherWeeklyHours(
  admin: SupabaseClient,
  teacherTelegramId: number,
  slots: WeeklySlotInput[],
): Promise<TeacherAvailabilitySlot[]> {
  await admin.from('teacher_availability').delete().eq('teacher_telegram_id', teacherTelegramId);

  if (slots.length === 0) return [];

  const rows = slots.map((slot) => ({
    teacher_telegram_id: teacherTelegramId,
    day_of_week: slot.dayOfWeek,
    start_time: slot.startTime,
    end_time: slot.endTime,
    kind: slot.kind ?? 'both',
  }));

  const { data, error } = await admin
    .from('teacher_availability')
    .insert(rows)
    .select('id, day_of_week, start_time, end_time');

  if (error) throw error;
  return (data ?? []).map((row) => mapWeeklyRow(row as Record<string, unknown>));
}

export async function addTeacherBlockedDate(
  admin: SupabaseClient,
  teacherTelegramId: number,
  blockedDate: string,
  note: string | null,
): Promise<TeacherBlockedDate> {
  await admin
    .from('teacher_day_overrides')
    .delete()
    .eq('teacher_telegram_id', teacherTelegramId)
    .eq('override_date', blockedDate);

  const { data, error } = await admin
    .from('teacher_blocked_dates')
    .upsert(
      {
        teacher_telegram_id: teacherTelegramId,
        blocked_date: blockedDate,
        note,
      },
      { onConflict: 'teacher_telegram_id,blocked_date' },
    )
    .select('id, blocked_date, note')
    .single();

  if (error) throw error;
  return {
    id: data.id as number,
    blockedDate: String(data.blocked_date),
    note: (data.note as string | null) ?? null,
  };
}

export async function removeTeacherBlockedDate(
  admin: SupabaseClient,
  teacherTelegramId: number,
  id: number,
): Promise<void> {
  const { error } = await admin
    .from('teacher_blocked_dates')
    .delete()
    .eq('id', id)
    .eq('teacher_telegram_id', teacherTelegramId);
  if (error) throw error;
}

/** Своё время на дату: заменяет часы шаблона и снимает «выходной». */
export async function setTeacherDayOverride(
  admin: SupabaseClient,
  teacherTelegramId: number,
  day: string,
  startTime: string,
  endTime: string,
): Promise<void> {
  const { error: delBlockedError } = await admin
    .from('teacher_blocked_dates')
    .delete()
    .eq('teacher_telegram_id', teacherTelegramId)
    .eq('blocked_date', day);
  if (delBlockedError) throw delBlockedError;

  const { error } = await admin.from('teacher_day_overrides').upsert(
    {
      teacher_telegram_id: teacherTelegramId,
      override_date: day,
      start_time: startTime,
      end_time: endTime,
    },
    { onConflict: 'teacher_telegram_id,override_date' },
  );
  if (error) throw error;
}

/** Вернуть день к недельному шаблону: убирает и свои часы, и «выходной». */
export async function clearTeacherDay(
  admin: SupabaseClient,
  teacherTelegramId: number,
  day: string,
): Promise<void> {
  const { error: overrideError } = await admin
    .from('teacher_day_overrides')
    .delete()
    .eq('teacher_telegram_id', teacherTelegramId)
    .eq('override_date', day);
  if (overrideError) throw overrideError;

  const { error: blockedError } = await admin
    .from('teacher_blocked_dates')
    .delete()
    .eq('teacher_telegram_id', teacherTelegramId)
    .eq('blocked_date', day);
  if (blockedError) throw blockedError;
}

export function isDateBlocked(blockedDates: TeacherBlockedDate[], dayKey: string): boolean {
  return blockedDates.some((item) => item.blockedDate === dayKey);
}



export type DayChange =
  | { type: 'off'; note: string | null }
  | { type: 'hours'; startTime: string; endTime: string }
  | { type: 'clear' };

/** Локальное (оптимистичное) применение изменения дня — до ответа сервера. */
export function applyDayChange(
  data: TeacherWorkingHoursData,
  day: string,
  change: DayChange,
): TeacherWorkingHoursData {
  const blockedDates = data.blockedDates.filter((item) => item.blockedDate !== day);
  const dayOverrides = (data.dayOverrides ?? []).filter((item) => item.overrideDate !== day);
  if (change.type === 'off') {
    blockedDates.push({ id: -1, blockedDate: day, note: change.note });
  } else if (change.type === 'hours') {
    dayOverrides.push({
      id: -1,
      overrideDate: day,
      startTime: change.startTime,
      endTime: change.endTime,
    });
  }
  return { ...data, blockedDates, dayOverrides };
}
