import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getTeacherCabinetData,
  type TeacherCabinetData,
  type TeacherGroupView,
  type TeacherLessonView,
  type TeacherStudentView,
} from '@/lib/teacher/cabinet-data';
import { formatLessonDateTimeRu } from '@/lib/teacher/format';

const MINSK = 'Europe/Minsk';
const UPCOMING_LIMIT = 20;

export type TeacherBotSnapshot = TeacherCabinetData & {
  pendingHomeworkByStudent: Map<number, number>;
};

function ymdInMinsk(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: MINSK });
}

function todayYmdInMinsk(now = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: MINSK });
}

export function lessonsToday(lessons: TeacherLessonView[], now = new Date()): TeacherLessonView[] {
  const today = todayYmdInMinsk(now);
  return lessons
    .filter((l) => l.status !== 'cancelled' && ymdInMinsk(l.startsAt) === today)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function lessonsUpcoming(lessons: TeacherLessonView[], now = new Date()): TeacherLessonView[] {
  const today = todayYmdInMinsk(now);
  const nowMs = now.getTime();
  return lessons
    .filter((l) => {
      if (l.status !== 'scheduled') return false;
      if (ymdInMinsk(l.startsAt) === today) return false;
      return new Date(l.startsAt).getTime() > nowMs;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, UPCOMING_LIMIT);
}

export function lessonStatusLabel(status: TeacherLessonView['status']): string {
  switch (status) {
    case 'scheduled':
      return 'запланировано';
    case 'completed':
      return 'проведено';
    case 'cancelled':
      return 'отменено';
    case 'no_show':
      return 'неявка';
    default:
      return status;
  }
}

export function lessonKindLabel(kind: TeacherLessonView['kind']): string {
  return kind === 'individual' ? 'индивидуальное' : 'групповое';
}

export function studentDisplayName(student: Pick<TeacherStudentView, 'name' | 'phone' | 'telegramId'>): string {
  return student.name?.trim() || student.phone?.trim() || `Ученик ${student.telegramId}`;
}

export function formatPackageLine(student: TeacherStudentView): string | null {
  const parts: string[] = [];
  if (student.packageCredits.individual) {
    parts.push(
      `инд.: ${student.packageCredits.individual.remaining}/${student.packageCredits.individual.total}`,
    );
  }
  if (student.packageCredits.group) {
    parts.push(
      `груп.: ${student.packageCredits.group.remaining}/${student.packageCredits.group.total}`,
    );
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

async function loadPendingHomeworkByStudent(
  admin: SupabaseClient,
  teacherTelegramId: number,
  groupMembers: Map<number, number[]>,
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  const bump = (telegramId: number) => counts.set(telegramId, (counts.get(telegramId) ?? 0) + 1);

  const { data, error } = await admin
    .from('homework_assignments')
    .select('id, review_status, scheduled_lessons!inner(id, teacher_telegram_id, telegram_id, group_id)')
    .eq('scheduled_lessons.teacher_telegram_id', teacherTelegramId)
    .in('review_status', ['submitted', 'reviewing']);
  if (error) {
    if (String(error.message).includes('homework_assignments')) return counts;
    throw error;
  }

  for (const row of data ?? []) {
    const raw = row.scheduled_lessons as
      | { telegram_id: number | null; group_id: number | null }
      | { telegram_id: number | null; group_id: number | null }[]
      | null;
    const lesson = Array.isArray(raw) ? raw[0] : raw;
    if (!lesson) continue;
    if (lesson.telegram_id) {
      bump(lesson.telegram_id);
      continue;
    }
    if (lesson.group_id) {
      for (const memberId of groupMembers.get(lesson.group_id) ?? []) bump(memberId);
    }
  }
  return counts;
}

export async function loadTeacherBotSnapshot(
  admin: SupabaseClient,
  teacherTelegramId: number,
): Promise<TeacherBotSnapshot> {
  const cabinet = await getTeacherCabinetData(admin, teacherTelegramId, null);
  const groupMembers = new Map<number, number[]>();
  for (const group of cabinet.groups) {
    groupMembers.set(
      group.id,
      group.members.map((m) => m.telegramId),
    );
  }
  const pendingHomeworkByStudent = await loadPendingHomeworkByStudent(
    admin,
    teacherTelegramId,
    groupMembers,
  );
  return { ...cabinet, pendingHomeworkByStudent };
}

export function findStudent(snapshot: TeacherBotSnapshot, telegramId: number): TeacherStudentView | undefined {
  return snapshot.students.find((s) => s.telegramId === telegramId);
}

export function findGroup(snapshot: TeacherBotSnapshot, groupId: number): TeacherGroupView | undefined {
  return snapshot.groups.find((g) => g.id === groupId);
}

export function findLesson(snapshot: TeacherBotSnapshot, lessonId: number): TeacherLessonView | undefined {
  return snapshot.allLessons.find((l) => l.id === lessonId);
}

export function individualStudents(snapshot: TeacherBotSnapshot): TeacherStudentView[] {
  return snapshot.students.filter(
    (s) => s.individualCount > 0 || s.lessons.some((l) => l.kind === 'individual'),
  );
}

export function lessonTitleLine(lesson: TeacherLessonView): string {
  const who =
    lesson.kind === 'individual'
      ? lesson.studentName ?? 'Ученик'
      : lesson.groupTitle ?? 'Группа';
  return `${formatLessonDateTimeRu(lesson.startsAt)} · ${who} · ${lesson.topic}`;
}
