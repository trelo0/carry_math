import type { CuratorLessonView } from '@/lib/curator/cabinet-data';
import type { TeacherLessonView } from '@/lib/teacher/cabinet-data';
import type { TeacherDaySlot } from '@/lib/teacher/cabinet-data';
import type {
  DayTimelineSegment,
  ScheduleEvent,
  ScheduleEventKind,
  ScheduleFilter,
  TeacherAvailabilitySlot,
} from '@/lib/teacher/schedule-types';

export const SCHEDULE_HOUR_START = 7;
export const SCHEDULE_HOUR_END = 22;
export const SCHEDULE_SLOT_HEIGHT = 48;
export const SCHEDULE_EVENT_GAP = 6;
export const SCHEDULE_DEFAULT_DURATION = 60;

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function getWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function formatWeekRange(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const sameMonth = weekStart.getMonth() === end.getMonth();
  const months = [
    'янв', 'фев', 'мар', 'апр', 'май', 'июн',
    'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
  ];
  if (sameMonth) {
    return `${weekStart.getDate()}–${end.getDate()} ${months[weekStart.getMonth()]} ${weekStart.getFullYear()}`;
  }
  return `${weekStart.getDate()} ${months[weekStart.getMonth()]} – ${end.getDate()} ${months[end.getMonth()]} ${end.getFullYear()}`;
}

export function formatDayTitle(date: Date): string {
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  const wd = WEEKDAY_LABELS[date.getDay() === 0 ? 6 : date.getDay() - 1];
  return `${wd}, ${date.getDate()} ${months[date.getMonth()]}`;
}

export function formatNavDateLong(date: Date): string {
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

export function timeToMinutes(value: string): number {
  const [hh, mm] = value.split(':').map(Number);
  return hh * 60 + mm;
}

export function minutesToTime(total: number): string {
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

export function lessonEndIso(startsAt: string, durationMinutes: number): string {
  return new Date(new Date(startsAt).getTime() + durationMinutes * 60_000).toISOString();
}

export function buildLocalIso(dateKeyStr: string, time: string): string {
  return new Date(`${dateKeyStr}T${time}:00`).toISOString();
}

export function durationFromRange(startTime: string, endTime: string): number {
  const diff = timeToMinutes(endTime) - timeToMinutes(startTime);
  return diff > 0 ? diff : SCHEDULE_DEFAULT_DURATION;
}

export function eventTopPx(startsAt: string, hourStart: number = SCHEDULE_HOUR_START): number {
  const d = new Date(startsAt);
  const minutes = d.getHours() * 60 + d.getMinutes();
  const startMinutes = hourStart * 60;
  return ((minutes - startMinutes) / 60) * SCHEDULE_SLOT_HEIGHT;
}

export function eventHeightPx(startsAt: string, endsAt: string): number {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  const hours = Math.max((end - start) / 3_600_000, 0.5);
  return hours * SCHEDULE_SLOT_HEIGHT;
}

export function eventBlockLayout(
  startsAt: string,
  endsAt: string,
  hourStart: number = SCHEDULE_HOUR_START,
): { top: number; height: number } {
  const rawTop = eventTopPx(startsAt, hourStart);
  const rawHeight = eventHeightPx(startsAt, endsAt);
  const gap = SCHEDULE_EVENT_GAP;
  const top = rawTop + gap;
  const height = Math.max(rawHeight - gap * 2, 28);
  return { top, height };
}

export function slotBlockLayout(
  startTime: string,
  endTime: string,
  hourStart: number,
): { top: number; height: number } {
  const dayKeyStr = '2000-01-01';
  const startIso = buildLocalIso(dayKeyStr, startTime);
  const endIso = buildLocalIso(dayKeyStr, endTime);
  return eventBlockLayout(startIso, endIso, hourStart);
}

export function getHoursInRange(hourStart: number, hourEndExclusive: number): number[] {
  const hours: number[] = [];
  for (let h = hourStart; h < hourEndExclusive; h++) hours.push(h);
  return hours;
}

export function dayGridTotalHeight(hourStart: number, hourEndExclusive: number): number {
  return Math.max(hourEndExclusive - hourStart, 1) * SCHEDULE_SLOT_HEIGHT;
}

/** Диапазон часов для дневной сетки: только занятия и явные слоты (без рабочего времени). */
export function getDayGridHourRange(
  day: Date,
  events: ScheduleEvent[],
  daySlots: TeacherDaySlot[] = [],
): { hourStart: number; hourEndExclusive: number } {
  const dayKeyStr = dateKey(day);
  const dayEvents = eventsForDay(events, day);
  const slots = daySlots.filter((s) => s.slotDate === dayKeyStr);

  if (dayEvents.length === 0 && slots.length === 0) {
    return { hourStart: 9, hourEndExclusive: 20 };
  }

  let minMinutes = SCHEDULE_HOUR_END * 60;
  let maxMinutes = SCHEDULE_HOUR_START * 60;

  for (const event of dayEvents) {
    const start = new Date(event.startsAt);
    minMinutes = Math.min(minMinutes, start.getHours() * 60 + start.getMinutes());
    const end = new Date(event.endsAt);
    maxMinutes = Math.max(maxMinutes, end.getHours() * 60 + end.getMinutes());
  }

  for (const slot of slots) {
    minMinutes = Math.min(minMinutes, timeToMinutes(slot.startTime));
    maxMinutes = Math.max(maxMinutes, timeToMinutes(slot.endTime));
  }

  const hourStart = Math.max(SCHEDULE_HOUR_START, Math.floor(minMinutes / 60));
  let hourEndExclusive = Math.max(hourStart + 1, Math.ceil(maxMinutes / 60));
  if (hourEndExclusive === SCHEDULE_HOUR_END) hourEndExclusive = SCHEDULE_HOUR_END + 1;
  hourEndExclusive = Math.min(SCHEDULE_HOUR_END + 1, hourEndExclusive);

  return { hourStart, hourEndExclusive };
}

export function formatDayAsideHeading(date: Date): { weekday: string; dateLine: string } {
  const weekdayUpper = ['ПОНЕДЕЛЬНИК', 'ВТОРНИК', 'СРЕДА', 'ЧЕТВЕРГ', 'ПЯТНИЦА', 'СУББОТА', 'ВОСКРЕСЕНЬЕ'];
  const monthsUpper = [
    'ЯНВАРЯ', 'ФЕВРАЛЯ', 'МАРТА', 'АПРЕЛЯ', 'МАЯ', 'ИЮНЯ',
    'ИЮЛЯ', 'АВГУСТА', 'СЕНТЯБРЯ', 'ОКТЯБРЯ', 'НОЯБРЯ', 'ДЕКАБРЯ',
  ];
  const idx = date.getDay() === 0 ? 6 : date.getDay() - 1;
  return {
    weekday: weekdayUpper[idx],
    dateLine: `${date.getDate()} ${monthsUpper[date.getMonth()]}`,
  };
}

export function slotOverlapsLesson(
  slotDate: string,
  startTime: string,
  endTime: string,
  events: ScheduleEvent[],
): boolean {
  const startsAt = buildLocalIso(slotDate, startTime);
  const endsAt = buildLocalIso(slotDate, endTime);
  return findScheduleConflict(events, startsAt, endsAt) !== null;
}

export function findDaySlotConflict(
  slotDate: string,
  startTime: string,
  endTime: string,
  events: ScheduleEvent[],
  daySlots: TeacherDaySlot[],
  excludeSlotId?: number,
): string | null {
  if (startTime >= endTime) return 'Время начала должно быть раньше окончания';

  const lessonConflict = findScheduleConflict(
    events,
    buildLocalIso(slotDate, startTime),
    buildLocalIso(slotDate, endTime),
  );
  if (lessonConflict) {
    return `Пересечение с занятием «${lessonConflict.title}»`;
  }

  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  for (const slot of daySlots) {
    if (slot.slotDate !== slotDate) continue;
    if (excludeSlotId && slot.id === excludeSlotId) continue;
    if (overlaps(startMin, endMin, timeToMinutes(slot.startTime), timeToMinutes(slot.endTime))) {
      return 'Пересечение с другим слотом';
    }
  }
  return null;
}

/** Свободные слоты дня, не пересекающиеся с занятиями. */
export function freeSlotsForDay(
  daySlots: TeacherDaySlot[],
  day: Date,
  events: ScheduleEvent[],
): TeacherDaySlot[] {
  const dayKeyStr = dateKey(day);
  return daySlots
    .filter((s) => s.slotDate === dayKeyStr && s.slotKind === 'extra')
    .filter((s) => !slotOverlapsLesson(dayKeyStr, s.startTime, s.endTime, events))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export type AutoSlotParams = {
  durationMinutes: number;
  firstStart: string;
  lastStart: string;
  breakMinutes: number;
};

export type AutoSlotCandidate = { startTime: string; endTime: string };

export function generateAutoSlots(params: AutoSlotParams): AutoSlotCandidate[] {
  const slots: AutoSlotCandidate[] = [];
  let currentStart = timeToMinutes(params.firstStart);
  const lastStart = timeToMinutes(params.lastStart);
  const { durationMinutes, breakMinutes } = params;

  while (currentStart <= lastStart) {
    slots.push({
      startTime: minutesToTime(currentStart),
      endTime: minutesToTime(currentStart + durationMinutes),
    });
    currentStart += durationMinutes + breakMinutes;
  }
  return slots;
}

export function partitionAutoSlots(
  slotDate: string,
  candidates: AutoSlotCandidate[],
  events: ScheduleEvent[],
  daySlots: TeacherDaySlot[],
): { creatable: AutoSlotCandidate[]; skipped: number } {
  const creatable: AutoSlotCandidate[] = [];
  let skipped = 0;
  const pending = [...candidates];

  for (const candidate of pending) {
    const conflict = findDaySlotConflict(slotDate, candidate.startTime, candidate.endTime, events, [
      ...daySlots,
      ...creatable.map((c, i) => ({
        id: -(i + 1),
        slotDate,
        startTime: c.startTime,
        endTime: c.endTime,
        slotKind: 'extra' as const,
        label: null,
      })),
    ]);
    if (conflict) {
      skipped += 1;
    } else {
      creatable.push(candidate);
    }
  }
  return { creatable, skipped };
}

export function isSameDay(a: Date, b: Date): boolean {
  return dateKey(a) === dateKey(b);
}

export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

export function mapTeacherLessonToEvent(lesson: TeacherLessonView): ScheduleEvent {
  const endsAt = lessonEndIso(lesson.startsAt, lesson.durationMinutes);
  const participantLabel =
    lesson.kind === 'group'
      ? lesson.groupTitle ?? (lesson.groupId ? 'Группа' : 'Без группы')
      : lesson.studentName ??
        (lesson.studentTelegramId ? `Ученик ${lesson.studentTelegramId}` : 'Без ученика');

  return {
    id: `lesson-${lesson.id}`,
    kind: lesson.kind,
    status: lesson.status,
    title: lesson.topic,
    startsAt: lesson.startsAt,
    endsAt,
    durationMinutes: lesson.durationMinutes,
    participantLabel,
    studentTelegramId: lesson.studentTelegramId ?? undefined,
    groupId: lesson.groupId ?? undefined,
    lessonId: lesson.id,
    meetUrl: lesson.meetUrl,
    boardUrl: lesson.boardUrl,
    lessonPlan: lesson.lessonPlan,
    cancelReason: lesson.cancelReason,
    sourceLesson: lesson,
  };
}

export function mapCourseLessonToEvent(lesson: CuratorLessonView, courseTitle: string): ScheduleEvent | null {
  const startsAt = lesson.scheduledAt ?? (lesson.lessonDate ? `${lesson.lessonDate}T18:00:00+03:00` : null);
  if (!startsAt) return null;

  const durationMinutes = 90;
  const statusMap: Record<string, ScheduleEvent['status']> = {
    scheduled: 'scheduled',
    waiting: 'scheduled',
    live: 'scheduled',
    completed: 'completed',
    cancelled: 'cancelled',
  };

  return {
    id: `course-${lesson.sanityId}`,
    kind: 'course',
    status: statusMap[lesson.sessionStatus] ?? 'scheduled',
    title: `Урок ${lesson.lessonNumber} · ${lesson.title}`,
    startsAt,
    endsAt: lessonEndIso(startsAt, durationMinutes),
    durationMinutes,
    participantLabel: `«${courseTitle}»`,
    sanityLessonId: lesson.sanityId,
    courseTitle,
    meetUrl: lesson.liveUrl,
    sourceCourseLesson: lesson,
  };
}

export function buildScheduleEvents(
  lessons: TeacherLessonView[],
  courseLessons: CuratorLessonView[],
  courseTitle: string,
): ScheduleEvent[] {
  const lessonEvents = lessons.map(mapTeacherLessonToEvent);
  const courseEvents = courseLessons
    .map((l) => mapCourseLessonToEvent(l, courseTitle))
    .filter((e): e is ScheduleEvent => e !== null);
  return [...lessonEvents, ...courseEvents].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function filterScheduleEvents(events: ScheduleEvent[], filter: ScheduleFilter): ScheduleEvent[] {
  if (filter === 'all') return events;
  if (filter === 'course') return events.filter((e) => e.kind === 'course');
  if (filter === 'ordinary') return events.filter((e) => e.kind === 'individual' || e.kind === 'group');
  return events.filter((e) => e.kind === filter);
}

export function eventsForDay(events: ScheduleEvent[], day: Date): ScheduleEvent[] {
  return events.filter((e) => isSameDay(new Date(e.startsAt), day));
}

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function findScheduleConflict(
  events: ScheduleEvent[],
  startsAt: string,
  endsAt: string,
  excludeId?: string,
): ScheduleEvent | null {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  for (const event of events) {
    if (excludeId && event.id === excludeId) continue;
    if (event.status === 'cancelled') continue;
    const eStart = new Date(event.startsAt).getTime();
    const eEnd = new Date(event.endsAt).getTime();
    if (overlaps(start, end, eStart, eEnd)) return event;
  }
  return null;
}

export function isWithinAvailability(
  availability: TeacherAvailabilitySlot[],
  date: Date,
  startTime: string,
  endTime: string,
): boolean {
  if (availability.length === 0) return true;
  const dayOfWeek = date.getDay() === 0 ? 6 : date.getDay() - 1;
  const daySlots = availability.filter((s) => s.dayOfWeek === dayOfWeek);
  if (daySlots.length === 0) return false;

  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  return daySlots.some((slot) => {
    const slotStart = timeToMinutes(slot.startTime);
    const slotEnd = timeToMinutes(slot.endTime);
    return start >= slotStart && end <= slotEnd;
  });
}

export function availabilityBandsForDay(
  availability: TeacherAvailabilitySlot[],
  day: Date,
): { startTime: string; endTime: string }[] {
  const dayOfWeek = day.getDay() === 0 ? 6 : day.getDay() - 1;
  return availability
    .filter((s) => s.dayOfWeek === dayOfWeek)
    .map((s) => ({ startTime: s.startTime, endTime: s.endTime }));
}

export function kindLabel(kind: ScheduleEventKind): string {
  if (kind === 'individual') return 'Индивидуальное';
  if (kind === 'group') return 'Групповое';
  return 'Курс';
}

export function kindBadgeLabel(kind: ScheduleEventKind): string {
  if (kind === 'individual') return 'ИНДИВИДУАЛЬНОЕ ЗАНЯТИЕ';
  if (kind === 'group') return 'ГРУППОВОЕ ЗАНЯТИЕ';
  return 'КУРС';
}

export function formatLessonDateTimeLine(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  const datePart = `${start.getDate()} ${months[start.getMonth()]}`;
  return `${datePart} · ${isoToTimeLabel(startsAt)}–${isoToTimeLabel(endsAt)}`;
}

export function statusLabel(status: ScheduleEvent['status']): string {
  const map: Record<ScheduleEvent['status'], string> = {
    scheduled: 'Запланировано',
    completed: 'Проведено',
    cancelled: 'Отменено',
    no_show: 'Не пришёл',
  };
  return map[status];
}

export function getScheduleHours(): number[] {
  const hours: number[] = [];
  for (let h = SCHEDULE_HOUR_START; h <= SCHEDULE_HOUR_END; h++) hours.push(h);
  return hours;
}

export function gridTotalHeight(): number {
  return (SCHEDULE_HOUR_END - SCHEDULE_HOUR_START + 1) * SCHEDULE_SLOT_HEIGHT;
}

export function isoToTimeLabel(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatTimeRange(startTime: string, endTime: string): string {
  return `${startTime} — ${endTime}`;
}

/** Сегменты дня: только явные события и слоты (без автогенерации из рабочего времени). */
export function buildDayTimeline(
  day: Date,
  events: ScheduleEvent[],
  _availability: TeacherAvailabilitySlot[],
  daySlots: TeacherDaySlot[] = [],
): DayTimelineSegment[] {
  const dayKeyStr = dateKey(day);
  const segments: DayTimelineSegment[] = [];

  const dayEvents = eventsForDay(events, day)
    .filter((e) => e.status !== 'cancelled')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  for (const event of dayEvents) {
    segments.push({
      type: 'lesson',
      event,
      startTime: isoToTimeLabel(event.startsAt),
      endTime: isoToTimeLabel(event.endsAt),
    });
  }

  for (const slot of daySlots.filter((s) => s.slotDate === dayKeyStr)) {
    if (slot.slotKind === 'extra') {
      segments.push({
        type: 'free',
        startTime: slot.startTime,
        endTime: slot.endTime,
        slotId: slot.id,
      });
    } else if (slot.slotKind === 'break') {
      segments.push({
        type: 'break',
        startTime: slot.startTime,
        endTime: slot.endTime,
        slotId: slot.id,
      });
    } else {
      segments.push({
        type: 'busy',
        startTime: slot.startTime,
        endTime: slot.endTime,
        slotId: slot.id,
        label: slot.label?.trim() || 'Занято',
      });
    }
  }

  return segments.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export function countDayTimelineStats(segments: DayTimelineSegment[]): {
  lessons: number;
  freeSlots: number;
} {
  let lessons = 0;
  let freeSlots = 0;
  for (const segment of segments) {
    if (segment.type === 'lesson') lessons += 1;
    if (segment.type === 'free') {
      const duration = timeToMinutes(segment.endTime) - timeToMinutes(segment.startTime);
      if (duration >= 30) freeSlots += 1;
    }
  }
  return { lessons, freeSlots };
}

export function findNextUpcomingEvent(events: ScheduleEvent[], from: Date = new Date()): ScheduleEvent | null {
  const now = from.getTime();
  const upcoming = events
    .filter((e) => e.status === 'scheduled' && new Date(e.startsAt).getTime() >= now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return upcoming[0] ?? null;
}
