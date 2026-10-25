import type { SanityWebinarSessionStatus } from '@/lib/curator/lesson-session';

/** Поля, нужные для порядка занятий в программе курса. */
export type CuratorLessonProgramFields = {
  moduleIndex: number;
  lessonNumber: number;
  courseLessonIndex: number;
  sessionStatus: SanityWebinarSessionStatus;
  endedAt: string | null;
  scheduledAt: string | null;
};

export function compareCuratorLessonsProgramOrder(
  a: Pick<CuratorLessonProgramFields, 'moduleIndex' | 'lessonNumber' | 'courseLessonIndex'>,
  b: Pick<CuratorLessonProgramFields, 'moduleIndex' | 'lessonNumber' | 'courseLessonIndex'>,
): number {
  return (
    a.moduleIndex - b.moduleIndex ||
    a.lessonNumber - b.lessonNumber ||
    (a.courseLessonIndex ?? 0) - (b.courseLessonIndex ?? 0)
  );
}

/** Дополняет сквозной №, если в JSON его нет (старый кэш / SSR). */
export function ensureCourseLessonIndices<T extends CuratorLessonProgramFields>(
  lessons: T[],
): T[] {
  const sorted = [...lessons].sort(compareCuratorLessonsProgramOrder);
  return sorted.map((lesson, index) => {
    const courseLessonIndex =
      typeof lesson.courseLessonIndex === 'number' && lesson.courseLessonIndex > 0
        ? lesson.courseLessonIndex
        : index + 1;
    if (lesson.courseLessonIndex === courseLessonIndex) return lesson;
    return { ...lesson, courseLessonIndex };
  });
}

export function findLastCompletedCuratorLesson<T extends CuratorLessonProgramFields>(
  lessons: T[],
): T | null {
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
      return tb - ta || compareCuratorLessonsProgramOrder(b, a);
    });
  return completed[0] ?? null;
}

export function findNextProgramCuratorLesson<T extends CuratorLessonProgramFields>(
  lessons: T[],
): T | null {
  return (
    [...lessons]
      .sort(compareCuratorLessonsProgramOrder)
      .find(
        (l) =>
          l.sessionStatus !== 'completed' &&
          l.sessionStatus !== 'cancelled' &&
          l.sessionStatus !== 'live',
      ) ?? null
  );
}

export function findNextCuratorLessonNeedingDate<T extends CuratorLessonProgramFields>(
  lessons: T[],
): T | null {
  return (
    [...lessons]
      .sort(compareCuratorLessonsProgramOrder)
      .find(
        (l) =>
          l.sessionStatus !== 'completed' &&
          l.sessionStatus !== 'cancelled' &&
          !l.scheduledAt,
      ) ?? null
  );
}
