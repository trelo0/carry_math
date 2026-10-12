import type { CourseLessonContent } from '@/lib/studio/courseContent';
import type { HomeworkProgressStatus } from './course-progress';

export type LessonProgressInput = {
  /** Legacy B — игнорируется в варианте A */
  watchPercent?: number | null;
  recordingWatchedAt?: string | null;
  liveAttendedAt?: string | null;
  materialsOpened?: string[] | null;
  materialKeys?: string[];
  homeworkStatus?: HomeworkProgressStatus | null;
  /** Есть ли обязательное ДЗ у урока */
  hasHomework: boolean;
};

/** Ключи файлов (оставлены для совместимости вызовов). */
export function collectLessonMaterialKeys(
  lesson: Pick<CourseLessonContent, 'materials' | 'homeworkFiles'>,
): string[] {
  const keys: string[] = [];
  for (const f of lesson.materials ?? []) {
    const key = (f.url || f.fileName || f.title || '').trim();
    if (key) keys.push(key);
  }
  for (const f of lesson.homeworkFiles ?? []) {
    const key = (f.url || f.fileName || f.title || '').trim();
    if (key) keys.push(key);
  }
  return [...new Set(keys)];
}

export function lessonHasHomework(
  lesson: Pick<CourseLessonContent, 'mandatoryHomework' | 'homework' | 'homeworkFiles'>,
): boolean {
  if (lesson.mandatoryHomework) return true;
  if (lesson.homework) return true;
  return (lesson.homeworkFiles?.length ?? 0) > 0;
}

/** Пробное без оплаты курса: только просмотр, без ДЗ и таймера. */
export function homeworkRequiredForLesson(
  lesson: Pick<
    CourseLessonContent,
    'isTrialFree' | 'mandatoryHomework' | 'homework' | 'homeworkFiles'
  >,
  hasCourseProduct: boolean,
): boolean {
  if (lesson.isTrialFree && !hasCourseProduct) return false;
  return lessonHasHomework(lesson);
}

/** Вариант A: Play (recording/live) → 60%, иначе 0. */
export function computeMaterialPercent(input: LessonProgressInput): number {
  if (input.recordingWatchedAt || input.liveAttendedAt) return 60;
  return 0;
}

/** Вариант A: ДЗ 0 / 20 / 40. Без ДЗ при материале 60% даём 40. */
export function homeworkContribution(
  homeworkStatus: HomeworkProgressStatus | null | undefined,
  hasHomework: boolean,
  materialPercent: number,
): number {
  if (!hasHomework) {
    return materialPercent >= 60 ? 40 : 0;
  }
  if (homeworkStatus === 'approved') return 40;
  if (homeworkStatus === 'submitted') return 20;
  return 0;
}

/** Прогресс урока 0–100% (A: Play 60 + ДЗ 40). */
export function computeLessonProgressPercent(input: LessonProgressInput): number {
  const material = computeMaterialPercent(input);
  const total = material + homeworkContribution(input.homeworkStatus, input.hasHomework, material);
  return Math.max(0, Math.min(100, total));
}

export function isLessonProgressCompleted(input: LessonProgressInput): boolean {
  return computeLessonProgressPercent(input) >= 100;
}

/**
 * Общий прогресс курса: sum(lesson%) / N.
 * Если есть хоть какой-то прогресс, а round дал 0 (мало уроков в числителе при большом N) — показываем 1%.
 */
export function aggregateCourseProgress(lessonPercents: number[]): {
  coursePercent: number;
  completedCount: number;
  totalLessons: number;
} {
  const totalLessons = lessonPercents.length;
  if (totalLessons === 0) {
    return { coursePercent: 0, completedCount: 0, totalLessons: 0 };
  }
  const sum = lessonPercents.reduce((acc, p) => acc + Math.max(0, Math.min(100, p)), 0);
  const completedCount = lessonPercents.filter((p) => p >= 100).length;
  let coursePercent = Math.round(sum / totalLessons);
  if (sum > 0 && coursePercent === 0) coursePercent = 1;
  return {
    coursePercent,
    completedCount,
    totalLessons,
  };
}
