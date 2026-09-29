import type { CuratorStudentView } from '@/lib/curator/students';
import type { TeacherGroupView, TeacherStudentView } from '@/lib/teacher/cabinet-data';

export type StaffStudentFilter = 'all' | 'ordinary' | 'course';

export type MergedStaffStudent = {
  telegramId: number;
  name: string;
  phone: string | null;
  hasOrdinary: boolean;
  hasCourse: boolean;
  teacher: TeacherStudentView | null;
  course: CuratorStudentView | null;
  groupTitles: string[];
  ordinaryLabel: string;
  courseLabel: string | null;
  lastActivityLabel: string | null;
};

export function getStudentGroupTitles(
  groups: TeacherGroupView[],
  telegramId: number,
): string[] {
  return groups
    .filter((group) => group.members.some((member) => member.telegramId === telegramId))
    .map((group) => group.title)
    .sort((a, b) => a.localeCompare(b, 'ru'));
}

function buildOrdinaryLabel(student: TeacherStudentView, groupTitles: string[]): string {
  if (student.individualCount > 0 && groupTitles.length === 0) {
    return 'Индивидуальные занятия';
  }
  if (groupTitles.length > 0 && student.individualCount === 0) {
    return groupTitles.length === 1 ? `Группа ${groupTitles[0]}` : groupTitles.join(', ');
  }
  if (groupTitles.length > 0 && student.individualCount > 0) {
    return `Индив. · ${groupTitles.join(', ')}`;
  }
  return 'Обычные занятия';
}

function formatLastActivity(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function buildLastActivity(
  teacher: TeacherStudentView | null,
  course: CuratorStudentView | null,
): string | null {
  const teacherLast = teacher?.lessons
    .filter((lesson) => lesson.status !== 'cancelled')
    .map((lesson) => lesson.startsAt)
    .sort((a, b) => b.localeCompare(a))[0];
  const teacherUpcoming = teacher?.nextLessonAt ?? null;

  if (teacherUpcoming) {
    return `Ближайшее: ${formatLastActivity(teacherUpcoming)}`;
  }
  if (teacherLast) {
    return `Последнее занятие: ${formatLastActivity(teacherLast)}`;
  }
  if (course) {
    return `Прогресс курса: ${course.progressPercent}%`;
  }
  return null;
}

export function mergeStaffStudents(params: {
  teacherStudents: TeacherStudentView[];
  teacherGroups: TeacherGroupView[];
  courseStudents: CuratorStudentView[];
  courseTitle: string;
}): MergedStaffStudent[] {
  const map = new Map<number, MergedStaffStudent>();

  for (const student of params.teacherStudents) {
    const groupTitles = getStudentGroupTitles(params.teacherGroups, student.telegramId);
    map.set(student.telegramId, {
      telegramId: student.telegramId,
      name: student.name ?? `ID ${student.telegramId}`,
      phone: student.phone,
      hasOrdinary: true,
      hasCourse: false,
      teacher: student,
      course: null,
      groupTitles,
      ordinaryLabel: buildOrdinaryLabel(student, groupTitles),
      courseLabel: null,
      lastActivityLabel: null,
    });
  }

  for (const student of params.courseStudents) {
    const existing = map.get(student.telegramId);
    const courseLabel = `Курс: ${params.courseTitle}`;
    if (existing) {
      existing.hasCourse = true;
      existing.course = student;
      existing.courseLabel = courseLabel;
      existing.name = existing.name || student.name;
      existing.phone = existing.phone ?? student.phone;
      existing.lastActivityLabel = buildLastActivity(existing.teacher, student);
      continue;
    }

    map.set(student.telegramId, {
      telegramId: student.telegramId,
      name: student.name,
      phone: student.phone,
      hasOrdinary: false,
      hasCourse: true,
      teacher: null,
      course: student,
      groupTitles: [],
      ordinaryLabel: '',
      courseLabel,
      lastActivityLabel: buildLastActivity(null, student),
    });
  }

  for (const entry of map.values()) {
    if (!entry.lastActivityLabel) {
      entry.lastActivityLabel = buildLastActivity(entry.teacher, entry.course);
    }
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function filterStaffStudents(
  students: MergedStaffStudent[],
  filter: StaffStudentFilter,
): MergedStaffStudent[] {
  if (filter === 'ordinary') return students.filter((student) => student.hasOrdinary);
  if (filter === 'course') return students.filter((student) => student.hasCourse);
  return students;
}

export function searchStaffStudents(
  students: MergedStaffStudent[],
  query: string,
): MergedStaffStudent[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return students;
  const digits = trimmed.replace(/\D/g, '');
  return students.filter((student) => {
    if (student.name.toLowerCase().includes(trimmed)) return true;
    if (String(student.telegramId).includes(trimmed)) return true;
    if (digits && student.phone?.replace(/\D/g, '').includes(digits)) return true;
    return false;
  });
}

export function getStaffStudentFilters(
  mode: 'teacher' | 'curator' | 'combined',
): { id: StaffStudentFilter; label: string }[] {
  if (mode === 'combined') {
    return [
      { id: 'all', label: 'Все' },
      { id: 'ordinary', label: 'Обычные' },
      { id: 'course', label: 'Курс' },
    ];
  }
  return [];
}
