import type { TeacherDaySlot, TeacherLessonView } from '@/lib/teacher/cabinet-data';
import type { ScheduleEvent, ScheduleViewMode } from '@/lib/teacher/schedule-types';
import {
  addDays,
  dateKey,
  isSameDay,
  timeToMinutes,
  validateLessonPlacementClient,
} from '@/lib/teacher/schedule-utils';
import { bandsContain, resolveDayHours, type TeacherWorkingHoursData } from '@/lib/teacher/working-hours';

const MONTHS_SHORT = [
  'янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.',
  'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.',
];
const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];
const MONTHS_NOM = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
const WEEKDAYS_FULL = [
  'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье',
];
export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKDAYS_SHORT_CLOCK = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export function weekdayIndex(date: Date): number {
  return date.getDay() === 0 ? 6 : date.getDay() - 1;
}

export function formatDayShort(date: Date): string {
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

export function formatPeriodLabel(mode: ScheduleViewMode, selectedDay: Date, weekStart: Date): string {
  if (mode === 'week') {
    const end = addDays(weekStart, 6);
    return `${formatDayShort(weekStart)} – ${formatDayShort(end)} ${end.getFullYear()}`;
  }
  if (mode === 'month') {
    return `${MONTHS_NOM[selectedDay.getMonth()]} ${selectedDay.getFullYear()}`;
  }
  return `${formatDayShort(selectedDay)} ${selectedDay.getFullYear()}`;
}

export function formatDayHeading(selected: Date, nowMs: number): string {
  const dateText = `${selected.getDate()} ${MONTHS_GEN[selected.getMonth()]}`;
  if (nowMs > 0 && isSameDay(selected, new Date(nowMs))) return `Сегодня, ${dateText}`;
  return `${WEEKDAYS_FULL[weekdayIndex(selected)]}, ${dateText}`;
}

export function formatClock(nowMs: number): { time: string; date: string } {
  if (nowMs <= 0) return { time: '--:--', date: '' };
  const d = new Date(nowMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    date: `${WEEKDAYS_SHORT_CLOCK[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`,
  };
}

export function formatNoteDate(date: Date): string {
  return `${date.getDate()} ${MONTHS_GEN[date.getMonth()]} ${date.getFullYear()}`;
}

/** 1 занятие / 2 занятия / 5 занятий. */
export function pluralLessons(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'занятие';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'занятия';
  return 'занятий';
}

export type BalanceTone = 'ok' | 'low' | 'empty' | 'none';

export function balanceTone(remaining: number | null): BalanceTone {
  if (remaining == null) return 'none';
  if (remaining <= 0) return 'empty';
  if (remaining <= 2) return 'low';
  return 'ok';
}

export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export type DayWorkState =
  | { kind: 'unset' }
  | { kind: 'off'; note: string | null }
  | { kind: 'work'; bands: { startTime: string; endTime: string }[]; custom: boolean };

export function getDayWorkState(
  workingHours: TeacherWorkingHoursData | undefined,
  day: Date,
): DayWorkState {
  const resolved = resolveDayHours(workingHours, day);
  if (resolved.kind === 'off') return { kind: 'off', note: resolved.note };
  return resolved;
}
export function workBandsLabel(bands: { startTime: string; endTime: string }[]): string {
  return bands.map((b) => `${b.startTime} – ${b.endTime}`).join(', ');
}

/** Нерабочие отрезки (минуты от начала суток) внутри [fromMin, toMin]. */
export function nonWorkingSegments(
  bands: { startTime: string; endTime: string }[],
  fromMin: number,
  toMin: number,
): { start: number; end: number }[] {
  const segments: { start: number; end: number }[] = [];
  let cursor = fromMin;
  for (const band of bands) {
    const start = Math.max(timeToMinutes(band.startTime), fromMin);
    const end = Math.min(timeToMinutes(band.endTime), toMin);
    if (end <= start) continue;
    if (start > cursor) segments.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < toMin) segments.push({ start: cursor, end: toMin });
  return segments;
}

export function isInsideBands(
  bands: { startTime: string; endTime: string }[],
  startMin: number,
  endMin: number,
): boolean {
  return bands.some(
    (band) => startMin >= timeToMinutes(band.startTime) && endMin <= timeToMinutes(band.endTime),
  );
}

export function snapMinutes(minutes: number, step = 15): number {
  return Math.floor(minutes / step) * step;
}

export type LaidOutEvent = {
  event: ScheduleEvent;
  lane: number;
  lanes: number;
  /** Границы кластера пересекающихся занятий, мс. */
  clusterStart: number;
  clusterEnd: number;
};

/** Раскладка пересекающихся занятий в соседние «дорожки». */
export function layoutDayEvents(events: ScheduleEvent[]): LaidOutEvent[] {
  const sorted = [...events].sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || a.endsAt.localeCompare(b.endsAt),
  );
  const result: LaidOutEvent[] = [];
  let cluster: { event: ScheduleEvent; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    const lanes = Math.max(...cluster.map((item) => item.lane)) + 1;
    const clusterStart = Math.min(...cluster.map((item) => Date.parse(item.event.startsAt)));
    for (const item of cluster) {
      result.push({ event: item.event, lane: item.lane, lanes, clusterStart, clusterEnd });
    }
    cluster = [];
    laneEnds = [];
    clusterEnd = -Infinity;
  };

  for (const event of sorted) {
    const start = Date.parse(event.startsAt);
    const end = Date.parse(event.endsAt);
    if (cluster.length > 0 && start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    cluster.push({ event, lane });
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return result;
}

export const DEFAULT_HOUR_START = 8;
export const DEFAULT_HOUR_END = 21;

/** Диапазон часов сетки: 08–21 по умолчанию, расширяется под занятия и окна. */
export function computeHourRange(
  days: Date[],
  events: ScheduleEvent[],
  slots: TeacherDaySlot[],
): { start: number; end: number } {
  let startMin = DEFAULT_HOUR_START * 60;
  let endMin = DEFAULT_HOUR_END * 60;
  const keys = new Set(days.map(dateKey));

  for (const event of events) {
    const start = new Date(event.startsAt);
    if (!keys.has(dateKey(start))) continue;
    const end = new Date(event.endsAt);
    startMin = Math.min(startMin, start.getHours() * 60 + start.getMinutes());
    if (isSameDay(start, end)) {
      endMin = Math.max(endMin, end.getHours() * 60 + end.getMinutes());
    } else {
      endMin = 24 * 60;
    }
  }
  for (const slot of slots) {
    if (!keys.has(slot.slotDate)) continue;
    startMin = Math.min(startMin, timeToMinutes(slot.startTime));
    endMin = Math.max(endMin, timeToMinutes(slot.endTime));
  }

  return {
    start: Math.max(0, Math.floor(startMin / 60)),
    end: Math.min(24, Math.ceil(endMin / 60)),
  };
}

export type WeekStats = {
  completed: number;
  cancelled: number;
  scheduled: number;
  /** Доля проведённых среди проведённых и «не пришёл», 0–100; null — данных нет. */
  attendance: number | null;
};

export function computeOrdinaryWeekStats(events: ScheduleEvent[], weekStart: Date): WeekStats {
  const from = weekStart.getTime();
  const to = addDays(weekStart, 7).getTime();
  const inWeek = events.filter((event) => {
    if (event.kind === 'course') return false;
    const t = Date.parse(event.startsAt);
    return t >= from && t < to;
  });
  const completed = inWeek.filter((e) => e.status === 'completed').length;
  const noShow = inWeek.filter((e) => e.status === 'no_show').length;
  const cancelled = inWeek.filter((e) => e.status === 'cancelled').length;
  const scheduled = inWeek.filter((e) => e.status === 'scheduled').length;
  const held = completed + noShow;
  return {
    completed,
    cancelled,
    scheduled,
    attendance: held > 0 ? Math.round((completed / held) * 100) : null,
  };
}

/** Запланированные занятия, время которых уже прошло, но они не завершены. */
export function findOverdueEvents(events: ScheduleEvent[], nowMs: number): ScheduleEvent[] {
  if (nowMs <= 0) return [];
  return events
    .filter(
      (event) =>
        event.kind !== 'course' && event.status === 'scheduled' && Date.parse(event.endsAt) < nowMs,
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}




export const LESSON_OVERLAP_ERROR_TEXT = 'ЗАНЯТИЕ ПЕРЕСЕКАЕТСЯ С ДРУГИМ ЗАНЯТИЕМ';

export function isLessonOverlapPlacementError(message: string | null): boolean {
  return message != null && message.startsWith('Конфликт с занятием');
}

/** Проверка места занятия: пересечения, блоки дня и рабочее время (сервер проверяет то же самое). */
export function validatePlacement(params: {
  slotDate: string;
  startTime: string;
  endTime: string;
  events: ScheduleEvent[];
  daySlots: TeacherDaySlot[];
  workingHours?: TeacherWorkingHoursData;
  excludeLessonId?: number;
}): string | null {
  const base = validateLessonPlacementClient({
    slotDate: params.slotDate,
    startTime: params.startTime,
    endTime: params.endTime,
    events: params.events,
    daySlots: params.daySlots,
    excludeLessonId: params.excludeLessonId,
  });
  if (base) return base;
  const [y, m, d] = params.slotDate.split('-').map(Number);
  const resolved = resolveDayHours(params.workingHours, new Date(y, m - 1, d));
  if (resolved.kind === 'off') return 'В этот день выходной';
  if (resolved.kind === 'work' && !bandsContain(resolved.bands, params.startTime, params.endTime)) {
    return `Вне рабочего времени (${workBandsLabel(resolved.bands)})`;
  }
  return null;
}

export type DayAvailability = {
  kind: 'unset' | 'off' | 'work';
  /** Рабочие интервалы дня (для «не задано» — условное окно 08:00–22:00). */
  bands: { start: number; end: number }[];
  busy: { start: number; end: number; label: string }[];
  /** Свободные интервалы внутри рабочих часов без занятых. */
  free: { start: number; end: number }[];
};

const FALLBACK_BAND = { start: 8 * 60, end: 22 * 60 };

/** Что занято и что свободно в день: для выбора времени без ручного ввода. */
export function computeDayAvailability(params: {
  day: Date;
  events: ScheduleEvent[];
  daySlots: TeacherDaySlot[];
  workingHours?: TeacherWorkingHoursData;
  excludeLessonId?: number;
}): DayAvailability {
  const resolved = resolveDayHours(params.workingHours, params.day);
  if (resolved.kind === 'off') return { kind: 'off', bands: [], busy: [], free: [] };

  const bands =
    resolved.kind === 'work'
      ? resolved.bands.map((b) => ({ start: timeToMinutes(b.startTime), end: timeToMinutes(b.endTime) }))
      : [FALLBACK_BAND];

  const key = dateKey(params.day);
  const excludeId = params.excludeLessonId ? `lesson-${params.excludeLessonId}` : undefined;
  const busy: DayAvailability['busy'] = [];
  for (const event of params.events) {
    if (event.id === excludeId || event.status !== 'scheduled') continue;
    if (event.kind !== 'individual' && event.kind !== 'group') continue;
    const start = new Date(event.startsAt);
    if (dateKey(start) !== key) continue;
    const startMin = start.getHours() * 60 + start.getMinutes();
    busy.push({
      start: startMin,
      end: startMin + event.durationMinutes,
      label: event.participantLabel,
    });
  }
  for (const slot of params.daySlots) {
    if (slot.slotDate !== key) continue;
    if (slot.slotKind !== 'blocked' && slot.slotKind !== 'break') continue;
    busy.push({
      start: timeToMinutes(slot.startTime),
      end: timeToMinutes(slot.endTime),
      label: slot.label?.trim() || 'Занято',
    });
  }
  busy.sort((a, b) => a.start - b.start);

  const free: DayAvailability['free'] = [];
  for (const band of bands) {
    let cursor = band.start;
    for (const block of busy) {
      if (block.end <= cursor || block.start >= band.end) continue;
      if (block.start > cursor) free.push({ start: cursor, end: Math.min(block.start, band.end) });
      cursor = Math.max(cursor, block.end);
    }
    if (cursor < band.end) free.push({ start: cursor, end: band.end });
  }
  return { kind: resolved.kind === 'work' ? 'work' : 'unset', bands, busy, free };
}

export const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;

/** Будущие занятия ученика: количество и постоянные слоты «Пн 16:00, Ср 18:00». */
export function rosterLessonSummary(
  lessons: TeacherLessonView[],
  studentId: number,
  nowMs: number,
): { upcoming: number; slots: string } {
  const future = lessons.filter(
    (lesson) =>
      lesson.scheduleStudentId === studentId &&
      lesson.status === 'scheduled' &&
      new Date(lesson.startsAt).getTime() > nowMs,
  );
  const slots = new Map<string, string>();
  for (const lesson of future) {
    const start = new Date(lesson.startsAt);
    const weekday = (start.getDay() + 6) % 7;
    const time = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
    slots.set(`${weekday}-${time}`, `${WEEKDAY_SHORT[weekday]} ${time}`);
  }
  const ordered = [...slots.entries()].sort(([a], [b]) => {
    const [da, ta] = a.split('-');
    const [db, tb] = b.split('-');
    return Number(da) - Number(db) || ta.localeCompare(tb);
  });
  return { upcoming: future.length, slots: ordered.map(([, label]) => label).join(', ') };
}
