import type { CuratorLessonView } from '@/lib/curator/cabinet-data';

export type CourseTab = 'overview' | 'lessons' | 'students';

export const COURSE_TABS: { id: CourseTab; label: string }[] = [
  { id: 'overview', label: 'Обзор' },
  { id: 'lessons', label: 'Занятия' },
  { id: 'students', label: 'Ученики' },
];

export function parseCourseTab(value: string | null | undefined): CourseTab | null {
  return value === 'overview' || value === 'lessons' || value === 'students' ? value : null;
}

/** Старые разделы `course-*` → вкладка единого экрана курса. */
export function legacySectionTab(section: string | undefined): CourseTab | null {
  switch (section) {
    case 'course-overview':
    case 'dashboard':
    case 'curator-dashboard':
    case 'course-homework':
    case 'homework':
    case 'curator-homework':
    case 'course-history':
    case 'course-list':
      return 'overview';
    case 'course-lessons':
    case 'lessons':
    case 'curator-lessons':
    case 'course-schedule':
      return 'lessons';
    case 'course-students':
    case 'students':
    case 'curator-students':
      return 'students';
    default:
      return null;
  }
}

export function isLessonDone(lesson: Pick<CuratorLessonView, 'sessionStatus'>): boolean {
  return lesson.sessionStatus === 'completed';
}

/** Запланированное: ещё не проведено и не отменено. */
export function isLessonUpcoming(lesson: Pick<CuratorLessonView, 'sessionStatus'>): boolean {
  return lesson.sessionStatus !== 'completed' && lesson.sessionStatus !== 'cancelled';
}

export type CourseLessonStats = {
  total: number;
  done: number;
  remaining: number;
  percent: number;
};

export function courseLessonStats(lessons: CuratorLessonView[]): CourseLessonStats {
  const total = lessons.length;
  const done = lessons.filter(isLessonDone).length;
  const remaining = lessons.filter(isLessonUpcoming).length;
  return { total, done, remaining, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
}

export type DateParts = { day: string; month: string; weekday: string; time: string };

export function lessonDateParts(iso: string | null): DateParts | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const weekday = d.toLocaleString('ru-RU', { weekday: 'short' });
  return {
    day: String(d.getDate()),
    month: d.toLocaleString('ru-RU', { month: 'short' }),
    weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1),
    time: d.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  };
}

export function lessonFullDate(iso: string | null): string {
  if (!iso) return 'Дата не указана';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Дата не указана';
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function lessonTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function lessonWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'занятие';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'занятия';
  return 'занятий';
}

export function studentWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'ученик';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'ученика';
  return 'учеников';
}
