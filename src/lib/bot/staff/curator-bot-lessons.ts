import type { CuratorLessonView } from '@/lib/curator/cabinet-data';

/** Последнее завершённое занятие (по статусу сессии, не только по дате). */
export function findLastCompletedLesson(lessons: CuratorLessonView[]): CuratorLessonView | null {
  const completed = lessons
    .filter((l) => l.sessionStatus === 'completed')
    .sort((a, b) => {
      const ta = a.endedAt
        ? new Date(a.endedAt).getTime()
        : a.scheduledAt
          ? new Date(a.scheduledAt).getTime()
          : 0;
      const tb = b.endedAt
        ? new Date(b.endedAt).getTime()
        : b.scheduledAt
          ? new Date(b.scheduledAt).getTime()
          : 0;
      return tb - ta;
    });
  return completed[0] ?? null;
}

/** Следующее по программе (ещё не completed/cancelled/live). */
export function findNextProgramLesson(lessons: CuratorLessonView[]): CuratorLessonView | null {
  return (
    [...lessons]
      .sort((a, b) => a.lessonNumber - b.lessonNumber)
      .find(
        (l) =>
          l.sessionStatus !== 'completed' &&
          l.sessionStatus !== 'cancelled' &&
          l.sessionStatus !== 'live',
      ) ?? null
  );
}

/**
 * Следующее занятие, которому нужно назначить дату:
 * по порядку программы, не завершено, дата ещё не задана.
 */
export function findNextLessonNeedingDate(lessons: CuratorLessonView[]): CuratorLessonView | null {
  return (
    [...lessons]
      .sort((a, b) => a.lessonNumber - b.lessonNumber)
      .find(
        (l) =>
          l.sessionStatus !== 'completed' &&
          l.sessionStatus !== 'cancelled' &&
          !l.scheduledAt,
      ) ?? null
  );
}

export function studentNextLessonLabel(
  lessons: CuratorLessonView[],
  completedLessons: number,
): string {
  const sorted = [...lessons].sort((a, b) => a.lessonNumber - b.lessonNumber);
  const next =
    sorted.find((l) => l.lessonNumber > completedLessons && l.sessionStatus !== 'cancelled') ??
    sorted.find((l) => l.sessionStatus !== 'completed' && l.sessionStatus !== 'cancelled');
  if (!next) return 'нет запланированных';
  const when = next.scheduledAt
    ? next.scheduledAt
    : next.lessonDate
      ? `${next.lessonDate} (время не задано)`
      : 'дата не назначена';
  return `№${next.lessonNumber} ${next.title} · ${when}`;
}
