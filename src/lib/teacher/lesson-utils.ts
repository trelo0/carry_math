import type { TeacherLessonView } from '@/lib/teacher/cabinet-data';

const LIVE_EARLY_MS = 10 * 60_000;

export function isLessonInLiveWindow(
  lesson: Pick<TeacherLessonView, 'status' | 'startsAt' | 'durationMinutes'>,
  nowMs = Date.now(),
): boolean {
  if (lesson.status !== 'scheduled') return false;
  const start = new Date(lesson.startsAt).getTime();
  const end = start + lesson.durationMinutes * 60_000;
  return nowMs >= start - LIVE_EARLY_MS && nowMs <= end;
}

export function findCurrentLesson(
  lessons: TeacherLessonView[],
  nowMs = Date.now(),
): TeacherLessonView | null {
  for (const lesson of lessons) {
    if (isLessonInLiveWindow(lesson, nowMs)) return lesson;
  }
  return null;
}

export function lessonEndIso(lesson: TeacherLessonView): string {
  const end = new Date(lesson.startsAt).getTime() + lesson.durationMinutes * 60_000;
  return new Date(end).toISOString();
}

export function timeToMinutes(value: string): number {
  const [hh, mm] = value.split(':').map(Number);
  return hh * 60 + mm;
}

export function minutesToTime(total: number): string {
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Одна карточка на групповой слот (несколько строк БД на одно время). */
export function dedupeGroupLessons(lessons: TeacherLessonView[]): TeacherLessonView[] {
  const seen = new Set<string>();
  const result: TeacherLessonView[] = [];
  for (const lesson of lessons) {
    const key = `${lesson.groupId ?? 'none'}:${lesson.startsAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(lesson);
  }
  return result;
}

export function mergeDayTimeline(
  lessons: TeacherLessonView[],
  freeSlots: { id: number; startTime: string; endTime: string }[],
): Array<
  | { type: 'lesson'; lesson: TeacherLessonView }
  | { type: 'free'; id: number; startTime: string; endTime: string }
> {
  const items: Array<
    | { type: 'lesson'; lesson: TeacherLessonView; sort: number }
    | { type: 'free'; id: number; startTime: string; endTime: string; sort: number }
  > = [];

  for (const lesson of lessons) {
    items.push({ type: 'lesson', lesson, sort: timeToMinutes(lesson.time) });
  }
  for (const slot of freeSlots) {
    items.push({ type: 'free', ...slot, sort: timeToMinutes(slot.startTime) });
  }

  return items
    .sort((a, b) => a.sort - b.sort)
    .map(({ sort: _sort, ...rest }) => rest);
}
