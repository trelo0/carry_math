import type { CabinetCourseStop } from '@/lib/cabinet';

function isStopCompleteForCourse(stop: CabinetCourseStop): boolean {
  if (stop.status === 'done') return true;
  if (stop.status === 'watched' && stop.homeworkStatus === 'approved') return true;
  return false;
}

function courseTrack(stops: CabinetCourseStop[]): CabinetCourseStop[] {
  return stops.filter((s) => !s.isJoinArchive);
}

/** Все учебные остановки (без join-archive) пройдены: просмотр + одобренное ДЗ. */
export function isCourseFullyCompleted(stops: CabinetCourseStop[]): boolean {
  const track = courseTrack(stops);
  if (track.length === 0) return false;
  return track.every(isStopCompleteForCourse);
}

export type CourseProgressSummary = {
  totalLessons: number;
  completedLessons: number;
  remainingLessons: number;
  coursePercent: number;
};

export function summarizeCourseProgress(stops: CabinetCourseStop[]): CourseProgressSummary {
  const track = courseTrack(stops);
  const totalLessons = track.length;
  const completedLessons = track.filter(isStopCompleteForCourse).length;
  const remainingLessons = Math.max(0, totalLessons - completedLessons);
  const coursePercent =
    totalLessons === 0 ? 0 : Math.min(100, Math.round((completedLessons / totalLessons) * 100));
  return { totalLessons, completedLessons, remainingLessons, coursePercent };
}

export function formatLessonCount(count: number): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${count} занятий`;
  const mod10 = count % 10;
  if (mod10 === 1) return `${count} занятие`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} занятия`;
  return `${count} занятий`;
}

export function courseCompleteStorageKey(phone: string, courseSlug: string): string {
  return `cab-course-complete:${phone}:${courseSlug}`;
}

export function readCourseCompleteSeen(phone: string, courseSlug: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(courseCompleteStorageKey(phone, courseSlug)) != null;
  } catch {
    return false;
  }
}

export function markCourseCompleteSeen(phone: string, courseSlug: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(courseCompleteStorageKey(phone, courseSlug), String(Date.now()));
  } catch {
    /* ignore */
  }
}
