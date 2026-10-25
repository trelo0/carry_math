import type { CuratorLessonView } from '@/lib/curator/cabinet-data';
import {
  compareCuratorLessonsProgramOrder,
  findLastCompletedCuratorLesson,
  findNextCuratorLessonNeedingDate,
  findNextProgramCuratorLesson,
} from '@/lib/curator/lesson-program-order';

export const findLastCompletedLesson = findLastCompletedCuratorLesson;
export const findNextProgramLesson = findNextProgramCuratorLesson;
export const findNextLessonNeedingDate = findNextCuratorLessonNeedingDate;

export function studentNextLessonLabel(
  lessons: CuratorLessonView[],
  completedLessons: number,
): string {
  const sorted = [...lessons].sort(compareCuratorLessonsProgramOrder);
  const next =
    sorted.find((l) => l.courseLessonIndex > completedLessons && l.sessionStatus !== 'cancelled') ??
    sorted.find((l) => l.sessionStatus !== 'completed' && l.sessionStatus !== 'cancelled');
  if (!next) return 'нет запланированных';
  const when = next.scheduledAt
    ? next.scheduledAt
    : next.lessonDate
      ? `${next.lessonDate} (время не задано)`
      : 'дата не назначена';
  return `№${next.courseLessonIndex} ${next.title} · ${when}`;
}
