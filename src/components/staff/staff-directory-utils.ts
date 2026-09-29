import type { CuratorStudentView } from '@/lib/curator/students';
import type { MergedStaffStudent } from '@/lib/staff/students-merge';
import type { TeacherGroupView, TeacherLessonView, TeacherStudentView } from '@/lib/teacher/cabinet-data';

export function studentContextLine(student: MergedStaffStudent): string {
  const parts: string[] = [];
  if (student.hasOrdinary) parts.push('Обычные');
  if (student.hasCourse) parts.push('Курс');
  return parts.join(' · ');
}

export function studentSubtitle(student: MergedStaffStudent, courseTitle: string): string | null {
  if (student.groupTitles.length > 0) return student.groupTitles[0];
  if (student.hasCourse) return courseTitle;
  return null;
}

export function countUpcomingOrdinaryLessons(teacher: TeacherStudentView): number {
  return teacher.lessons.filter((lesson) => lesson.isUpcoming).length;
}

export function lessonsCountLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} занятие`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${count} занятия`;
  return `${count} занятий`;
}

export function formatNextOrdinaryWhen(iso: string | null, lessons: TeacherLessonView[]): string | null {
  const targetIso =
    iso ??
    lessons
      .filter((lesson) => lesson.isUpcoming)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]?.startsAt ??
    null;
  if (!targetIso) return null;

  const date = new Date(targetIso);
  if (Number.isNaN(date.getTime())) return null;

  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  if (date.toDateString() === now.toDateString()) return `сегодня ${time}`;
  if (date.toDateString() === tomorrow.toDateString()) return `завтра ${time}`;

  const day = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return `${day} ${time}`;
}

export function formatCourseNextLabel(course: CuratorStudentView): string {
  const nextNum = Math.min(course.completedLessons + 1, course.totalLessons);
  if (nextNum <= 0) return 'Урок 1';
  return `Урок ${nextNum}`;
}

export function getGroupNextLesson(group: TeacherGroupView): TeacherLessonView | null {
  return (
    group.lessons
      .filter((lesson) => lesson.isUpcoming)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null
  );
}

export function formatGroupLessonDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

export function formatGroupLessonTimeRange(lesson: TeacherLessonView): string {
  const start = new Date(lesson.startsAt);
  const end = new Date(start.getTime() + lesson.durationMinutes * 60_000);
  const startTime = start.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const endTime = end.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${startTime} — ${endTime}`;
}

export function groupCardSubtitle(group: TeacherGroupView): string {
  const next = getGroupNextLesson(group);
  if (next?.topic?.trim()) return next.topic.trim();
  return 'Групповые занятия';
}

export function membersCountLabel(count: number): string {
  if (count === 1) return '1 ученик';
  if (count >= 2 && count <= 4) return `${count} ученика`;
  return `${count} учеников`;
}
