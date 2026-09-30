import type { SupabaseClient } from '@supabase/supabase-js';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';
import { getCuratorCabinetData } from '@/lib/curator/cabinet-data';
import { formatLessonDateTimeRu } from '@/lib/teacher/format';
import { resolveCourseIdForContent } from '@/lib/bot/education/course-record';
import { getEnrollmentLives, isLivesTableError } from '@/lib/bot/education/lives';
import {
  loadCuratorStudents,
  summarizeCuratorStudents,
  type CuratorStudentRecord,
} from '@/lib/bot/curator/curatorData';
import { listCuratorThreads } from './messaging';

/** Порог «мало жизней» для Arena (v1). */
export const CURATOR_LOW_LIVES_THRESHOLD = 2;

/** Дней без сдачи/завершения урока для «низкой активности» (v1). */
export const CURATOR_LOW_ACTIVITY_DAYS = 14;

export type CuratorLowLivesEntry = {
  student: CuratorStudentRecord;
  livesCurrent: number;
  livesMax: number | null;
};

export type CuratorActivitySnapshot = {
  awaitingReview: number;
  newQuestions: number;
  lowLivesCount: number;
  lowActivityCount: number;
  liveLine: string;
  nextLine: string;
  lowLives: CuratorLowLivesEntry[];
  lowActivityStudents: CuratorStudentRecord[];
};

async function listLowLivesStudents(
  admin: SupabaseClient,
  students: CuratorStudentRecord[],
): Promise<CuratorLowLivesEntry[]> {
  const content = await getDistrictCourseContent();
  if (!content) return [];
  let courseId: number | null = null;
  try {
    courseId = await resolveCourseIdForContent(admin, content);
  } catch {
    return [];
  }
  if (!courseId) return [];

  const out: CuratorLowLivesEntry[] = [];
  for (const student of students) {
    try {
      const lives = await getEnrollmentLives(admin, student.telegramId, courseId);
      const current = lives?.lives_current;
      if (typeof current !== 'number') continue;
      if (current <= CURATOR_LOW_LIVES_THRESHOLD) {
        out.push({
          student,
          livesCurrent: current,
          livesMax: lives?.lives_max ?? null,
        });
      }
    } catch (error) {
      if (!isLivesTableError(error)) throw error;
    }
  }
  out.sort((a, b) => a.livesCurrent - b.livesCurrent || a.student.name.localeCompare(b.student.name, 'ru'));
  return out;
}

async function listLowActivityStudents(
  admin: SupabaseClient,
  students: CuratorStudentRecord[],
): Promise<CuratorStudentRecord[]> {
  const content = await getDistrictCourseContent();
  if (!content || students.length === 0) return [];

  let courseId: number | null = null;
  try {
    courseId = await resolveCourseIdForContent(admin, content);
  } catch {
    return [];
  }
  if (!courseId) return [];

  const ids = students.map((s) => s.telegramId);
  const cutoff = Date.now() - CURATOR_LOW_ACTIVITY_DAYS * 86400000;

  const [{ data: enrollments }, { data: progressRows }] = await Promise.all([
    admin
      .from('course_enrollments')
      .select('telegram_id, started_at')
      .eq('course_id', courseId)
      .in('telegram_id', ids),
    admin
      .from('course_lesson_student_progress')
      .select('telegram_id, completed_at, homework_submitted_at, updated_at')
      .in('telegram_id', ids),
  ]);

  const enrolledAt = new Map<number, number>();
  for (const row of enrollments ?? []) {
    const ts = Date.parse(String(row.started_at ?? ''));
    if (Number.isFinite(ts)) enrolledAt.set(row.telegram_id as number, ts);
  }

  const lastTouch = new Map<number, number>();
  for (const row of progressRows ?? []) {
    const id = row.telegram_id as number;
    for (const field of [row.completed_at, row.homework_submitted_at, row.updated_at]) {
      const ts = Date.parse(String(field ?? ''));
      if (!Number.isFinite(ts)) continue;
      lastTouch.set(id, Math.max(lastTouch.get(id) ?? 0, ts));
    }
  }

  const out: CuratorStudentRecord[] = [];
  for (const student of students) {
    const start = enrolledAt.get(student.telegramId);
    if (!start || start > cutoff) continue;
    const touch = lastTouch.get(student.telegramId) ?? start;
    if (touch >= cutoff) continue;
    const hasApproved = student.homeworks.some((hw) => hw.status === 'approved');
    const hasSubmitted = student.homeworks.some((hw) => hw.status === 'submitted' || hw.status === 'revision');
    if (hasApproved || hasSubmitted) continue;
    out.push(student);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

function formatLiveLine(liveCount: number, titles: string[]): string {
  if (liveCount === 0) return '🔴 Сейчас в эфире: нет';
  if (titles.length === 0) return `🔴 Сейчас в эфире: ${liveCount}`;
  return `🔴 Сейчас в эфире: ${titles.join('; ')}`;
}

function formatNextLine(nextTitle: string | null, nextAt: string | null): string {
  if (!nextTitle) return '📅 Ближайший урок: не запланирован';
  const when = nextAt ? formatLessonDateTimeRu(nextAt) : 'дата уточняется';
  return `📅 Ближайший урок: ${nextTitle} · ${when}`;
}

export async function loadCuratorActivitySnapshot(
  admin: SupabaseClient,
  curatorTelegramId: number,
): Promise<CuratorActivitySnapshot> {
  const [students, { threads }, cabinet] = await Promise.all([
    loadCuratorStudents(admin, curatorTelegramId),
    listCuratorThreads(admin, curatorTelegramId),
    getCuratorCabinetData(admin, curatorTelegramId, null),
  ]);

  const hw = summarizeCuratorStudents(students);
  const newQuestions = threads.filter((t) => t.unreadCount > 0).length;
  const lowLives = await listLowLivesStudents(admin, students);
  const lowActivityStudents = await listLowActivityStudents(admin, students);

  const liveTitles = cabinet.dashboard.liveLessons.map((l) => `Урок ${l.lessonNumber}`);
  const next = cabinet.dashboard.nextLesson;

  return {
    awaitingReview: hw.awaitingReview,
    newQuestions,
    lowLivesCount: lowLives.length,
    lowActivityCount: lowActivityStudents.length,
    liveLine: formatLiveLine(cabinet.dashboard.liveNow, liveTitles),
    nextLine: formatNextLine(next?.title ?? null, next?.scheduledAt ?? null),
    lowLives,
    lowActivityStudents,
  };
}
