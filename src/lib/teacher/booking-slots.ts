import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildLocalIso,
  lessonEndIso,
  minutesToTime,
  overlaps,
  timeToMinutes,
} from '@/lib/teacher/schedule-utils';
import type { BookingSlotView } from '@/lib/teacher/booking-types';

const SLOT_STEP_MINUTES = 30;
const DEFAULT_DURATION = 60;

type BusyInterval = { startMs: number; endMs: number };

async function loadDaySlots(
  admin: SupabaseClient,
  teacherTelegramId: number,
  dateKeyStr: string,
): Promise<{ extra: Array<{ start: number; end: number }>; blocked: Array<{ start: number; end: number }> }> {
  const { data } = await admin
    .from('teacher_day_slots')
    .select('start_time, end_time, slot_kind')
    .eq('teacher_telegram_id', teacherTelegramId)
    .eq('slot_date', dateKeyStr);

  const extra: Array<{ start: number; end: number }> = [];
  const blocked: Array<{ start: number; end: number }> = [];
  for (const row of data ?? []) {
    const interval = {
      start: timeToMinutes(String(row.start_time).slice(0, 5)),
      end: timeToMinutes(String(row.end_time).slice(0, 5)),
    };
    const kind = row.slot_kind as string | undefined;
    if (kind === 'blocked' || kind === 'break') {
      blocked.push(interval);
    } else {
      extra.push(interval);
    }
  }
  return { extra, blocked };
}

async function loadBusyIntervals(
  admin: SupabaseClient,
  teacherTelegramId: number,
  dayStart: Date,
  dayEnd: Date,
): Promise<BusyInterval[]> {
  const intervals: BusyInterval[] = [];

  const { data: lessons } = await admin
    .from('scheduled_lessons')
    .select('starts_at, duration_minutes, status')
    .eq('teacher_telegram_id', teacherTelegramId)
    .gte('starts_at', dayStart.toISOString())
    .lt('starts_at', dayEnd.toISOString());
  for (const row of lessons ?? []) {
    if (row.status === 'cancelled') continue;
    const startMs = new Date(row.starts_at as string).getTime();
    const endMs = new Date(
      lessonEndIso(row.starts_at as string, (row.duration_minutes as number) ?? DEFAULT_DURATION),
    ).getTime();
    intervals.push({ startMs, endMs });
  }

  const { data: pending } = await admin
    .from('lesson_booking_requests')
    .select('starts_at, duration_minutes')
    .eq('teacher_telegram_id', teacherTelegramId)
    .eq('status', 'pending')
    .gte('starts_at', dayStart.toISOString())
    .lt('starts_at', dayEnd.toISOString());
  for (const row of pending ?? []) {
    const startMs = new Date(row.starts_at as string).getTime();
    const endMs = new Date(
      lessonEndIso(row.starts_at as string, (row.duration_minutes as number) ?? DEFAULT_DURATION),
    ).getTime();
    intervals.push({ startMs, endMs });
  }

  return intervals;
}

export async function listAvailableBookingSlots(
  admin: SupabaseClient,
  teacherTelegramId: number,
  dateKeyStr: string,
  durationMinutes = DEFAULT_DURATION,
): Promise<BookingSlotView[]> {
  const day = new Date(`${dateKeyStr}T12:00:00`);
  if (Number.isNaN(day.getTime())) return [];

  const dayStart = new Date(`${dateKeyStr}T00:00:00`);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const [daySlots, busyBase] = await Promise.all([
    loadDaySlots(admin, teacherTelegramId, dateKeyStr),
    loadBusyIntervals(admin, teacherTelegramId, dayStart, dayEnd),
  ]);

  const busy = [
    ...busyBase,
    ...daySlots.blocked.flatMap((slot) => {
      const startsAt = buildLocalIso(dateKeyStr, minutesToTime(slot.start));
      const endsAt = buildLocalIso(dateKeyStr, minutesToTime(slot.end));
      return [{ startMs: new Date(startsAt).getTime(), endMs: new Date(endsAt).getTime() }];
    }),
  ];

  const windows = daySlots.extra;
  if (windows.length === 0) return [];

  const slots: BookingSlotView[] = [];
  const nowMs = Date.now();

  for (const window of windows) {
    for (let startMin = window.start; startMin + durationMinutes <= window.end; startMin += SLOT_STEP_MINUTES) {
      const hh = String(Math.floor(startMin / 60)).padStart(2, '0');
      const mm = String(startMin % 60).padStart(2, '0');
      const time = `${hh}:${mm}`;
      const startsAt = buildLocalIso(dateKeyStr, time);
      const startMs = new Date(startsAt).getTime();
      if (startMs <= nowMs) continue;
      const endAt = lessonEndIso(startsAt, durationMinutes);
      const endMs = new Date(endAt).getTime();

      const conflict = busy.some((b) => overlaps(startMs, endMs, b.startMs, b.endMs));
      if (conflict) continue;

      const endMin = startMin + durationMinutes;
      const endLabel = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      slots.push({ startsAt, endAt, label: `${time} — ${endLabel}` });
    }
  }

  return slots;
}
